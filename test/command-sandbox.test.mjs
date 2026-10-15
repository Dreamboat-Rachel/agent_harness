import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CommandSandbox, windowsPathToWsl } from "../src/command-sandbox.mjs";

test("Windows workspace paths map into WSL", () => {
  assert.equal(windowsPathToWsl("C:\\work\\agent"), "/mnt/c/work/agent");
});

test("bubblewrap writes only inside the workspace, blocks outside reads and network", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-sandbox-"));
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside.txt");
  const secret = path.join(root, "secret.txt");
  await fs.mkdir(workspace);
  await fs.writeFile(secret, "not-readable", "utf8");
  const sandbox = new CommandSandbox({ workspaceRoot: workspace, network: "none" });
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 }));

  const status = await sandbox.init();
  assert.equal(status.available, true, status.error);
  const allowedWrite = await sandbox.run("printf allowed > allowed.txt; cat allowed.txt");
  assert.match(allowedWrite, /allowed/, allowedWrite);
  assert.equal(await exists(path.join(workspace, "allowed.txt")), true, allowedWrite);
  assert.equal((await fs.readFile(path.join(workspace, "allowed.txt"), "utf8")).trim(), "allowed");

  const outsidePath = process.platform === "win32" ? windowsPathToWsl(outside) : outside;
  const secretPath = process.platform === "win32" ? windowsPathToWsl(secret) : secret;
  const deniedWrite = await sandbox.run(`printf denied > '${outsidePath}'`);
  assert.match(deniedWrite, /no such file|read-only|permission denied/i);
  await assert.rejects(fs.access(outside));

  const deniedRead = await sandbox.run(`cat '${secretPath}'`);
  assert.doesNotMatch(deniedRead, /not-readable/);
  assert.match(deniedRead, /no such file|permission denied/i);

  const deniedNetwork = await sandbox.run("python3 -c 'import socket; s=socket.socket(); s.settimeout(2); s.connect((\"1.1.1.1\",443))'");
  assert.match(deniedNetwork, /network is unreachable|permission denied|timed out/i);
  const invocation = sandbox.invocation("echo ok");
  assert.ok(invocation.argv.includes("--unshare-net"));
  assert.ok(invocation.argv.includes("/workspace"));
  assert.equal(invocation.argv.includes("/mnt/c"), false);
});

async function exists(value) { try { await fs.access(value); return true; } catch { return false; } }
