import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("desktop runtime announces a random port and requires its shutdown token", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-desktop-runtime-"));
  const portFile = path.join(root, "server-port");
  const token = "desktop-test-token";
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0",
      PENGUIN_HOME: path.join(root, "data"),
      PENGUIN_ENV_FILE: path.join(root, ".env"),
      PENGUIN_PORT_FILE: portFile,
      PENGUIN_DESKTOP_TOKEN: token,
      LLM_BASE_URL: "",
      LLM_API_KEY: "",
      LLM_MODEL: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const port = await waitFor(async () => {
    try { return Number(await fs.readFile(portFile, "utf8")); } catch { return 0; }
  }, 5000, () => stderr);
  assert.ok(port > 0);
  const base = `http://127.0.0.1:${port}`;
  const capabilities = await fetch(`${base}/api/capabilities`);
  assert.equal(capabilities.ok, true);

  const forbidden = await fetch(`${base}/api/desktop/shutdown`, { method: "POST" });
  assert.equal(forbidden.status, 403);
  const accepted = await fetch(`${base}/api/desktop/shutdown`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(accepted.status, 202);
  const exitCode = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`server did not exit\n${stderr}`)), 5000))
  ]);
  assert.equal(exitCode, 0);
});

async function waitFor(check, timeout = 3000, diagnostic = () => "") {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const result = await check(); if (result !== false && result !== 0) return result; } catch { }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`condition timed out\n${diagnostic()}`);
}
