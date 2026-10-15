import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const policy of ["workspace-write", "assistant-approve"]) test(`runtime streams and writes code with ${policy}`, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-stream-runtime-"));
  const workspace = path.join(root, "workspace");
  let providerCalls = 0;
  let requestHeaders;
  let firstBody;
  let reviews = 0;
  const provider = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body.stream) {
      reviews += 1;
      assert.equal(body.tools, undefined);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decision: "allow", reason: "用户要求写代码，限工作区内写入" }) } }] }));
    }
    requestHeaders = req.headers;
    firstBody = firstBody || body;
    providerCalls += 1;
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
    const send = (delta) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    if (providerCalls === 1) {
      send({ tool_calls: [{ index: 0, id: "call-write", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "demo.py", content: "print('hello')\n" }) } }] });
    } else {
      send({ content: "代码" });
      await sleep(80);
      send({ content: "已写入" });
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const providerPort = provider.address().port;
  const port = 24000 + Math.floor(Math.random() * 12000);
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PENGUIN_HOME: root,
      PENGUIN_WORKSPACE: workspace,
      PENGUIN_ENV_FILE: path.join(root, ".env"),
      PORT: String(port),
      HOST: "127.0.0.1",
      LLM_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
      LLM_API_KEY: "test-only-key",
      LLM_MODEL: "test-model",
      TOOL_POLICY: policy,
      MEMORY_AUTO_LEARN: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await new Promise((resolve) => provider.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/api/capabilities`)).ok, 5000, () => stderr);
  const session = await request(base, "/api/sessions", { method: "POST", body: "{}" });
  const streamResponse = await fetch(`${base}/api/sessions/${session.id}/stream`);
  const eventsPromise = collectUntilIdle(streamResponse.body);
  await request(base, `/api/sessions/${session.id}/tasks`, { method: "POST", body: JSON.stringify({ text: "请写入一个 Python 文件" }) });
  const events = await eventsPromise;
  const storedSession = await request(base, `/api/sessions/${session.id}`);

  assert.equal(firstBody.stream, true);
  assert.equal(requestHeaders.authorization, "Bearer test-only-key");
  assert.equal(providerCalls, 2);
  assert.equal(reviews, policy === "assistant-approve" ? 1 : 0);
  assert.equal(events.filter((event) => event.type === "assistant_delta").length, 2);
  assert.equal(events.some((event) => event.type === "approval_request"), false);
  assert.equal(storedSession.messages.find((message) => message.toolName === "write_file").status, "completed");
  assert.equal(storedSession.messages.at(-1).content, "代码已写入");
  assert.equal(await fs.readFile(path.join(workspace, "demo.py"), "utf8"), "print('hello')\n");
});

async function collectUntilIdle(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const type = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!type || !data) continue;
      const payload = JSON.parse(data);
      events.push({ type, payload });
      if (type === "task_state" && payload.status === "idle") return events;
    }
    if (done) return events;
  }
}

async function request(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, { headers: { "content-type": "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function waitFor(check, timeout, diagnostic) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const result = await check(); if (result) return result; } catch { }
    await sleep(40);
  }
  throw new Error(`condition timed out\n${diagnostic()}`);
}
