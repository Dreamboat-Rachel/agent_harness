import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("HTTP runtime supports persistence APIs and stopping pending approvals", async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-server-"));
  const port = 21000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: projectRoot,
    env: { ...process.env, PENGUIN_HOME: dataRoot, PENGUIN_ENV_FILE: path.join(dataRoot, ".env"), PORT: String(port), TOOL_POLICY: "always-ask", LLM_BASE_URL: "", LLM_API_KEY: "", LLM_MODEL: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await fs.rm(dataRoot, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/api/capabilities`)).ok, 5000, () => stderr);
  const capabilities = await request(base, "/api/capabilities");
  assert.equal(capabilities.persistence, "sqlite+jsonl");
  assert.ok(capabilities.features.includes("langgraph-memory"));
  assert.ok(capabilities.features.includes("knowledge-graph"));
  assert.ok(capabilities.features.includes("bocha-web-search"));

  const manualMemory = await request(base, "/api/memory/facts", {
    method: "POST",
    body: JSON.stringify({ kind: "preference", subject: "user", predicate: "prefers", object: "简洁回答", content: "用户喜欢简洁回答" })
  });
  assert.equal(manualMemory.facts.length, 1);
  assert.equal((await request(base, "/api/memory?query=简洁")).facts[0].content, "用户喜欢简洁回答");
  assert.equal((await request(base, "/api/knowledge-graph?query=简洁")).relations[0].predicate, "prefers");
  assert.deepEqual(await request(base, "/api/memory/stats"), { facts: 1, entities: 2, relations: 1, events: 1 });

  const session = await request(base, "/api/sessions", { method: "POST", body: "{}" });
  await request(base, `/api/sessions/${session.id}/tasks`, { method: "POST", body: JSON.stringify({ text: "我喜欢使用中文回答" }) });
  await waitFor(async () => (await request(base, `/api/sessions/${session.id}`)).status === "idle");
  assert.ok((await request(base, "/api/memory?query=中文")).facts.some((fact) => fact.object === "使用中文回答"));

  await request(base, `/api/sessions/${session.id}/tasks`, { method: "POST", body: JSON.stringify({ text: "写入 test.txt pending" }) });
  await waitFor(async () => (await request(base, `/api/sessions/${session.id}`)).approvals.length === 1);
  await request(base, `/api/sessions/${session.id}/stop`, { method: "POST", body: "{}" });
  await waitFor(async () => (await request(base, `/api/sessions/${session.id}`)).status === "idle");
  const stopped = await request(base, `/api/sessions/${session.id}`);
  assert.equal(stopped.approvals.length, 0);
  assert.match(stopped.messages.at(-1).content, /任务已停止/);

  await request(base, `/api/sessions/${session.id}/tasks`, { method: "POST", body: JSON.stringify({ text: "子代理 inspect this task" }) });
  const subagentApproval = await waitFor(async () => {
    const approvals = (await request(base, `/api/sessions/${session.id}`)).approvals;
    return approvals[0] || false;
  });
  await request(base, `/api/sessions/${session.id}/approvals`, { method: "POST", body: JSON.stringify({ id: subagentApproval.id, decision: "allow" }) });
  await waitFor(async () => (await request(base, `/api/sessions/${session.id}`)).status === "idle");
  const withSubagent = await request(base, `/api/sessions/${session.id}`);
  assert.equal(withSubagent.subagents[0].status, "completed");
  assert.match(withSubagent.subagents[0].result, /演示模式已收到/);

  // Switching a pending approval must re-evaluate it, without executing twice.
  await request(base, `/api/sessions/${session.id}/tasks`, { method: "POST", body: JSON.stringify({ text: "写入 switched.txt approved" }) });
  await waitFor(async () => (await request(base, `/api/sessions/${session.id}`)).approvals.length === 1);
  await request(base, "/api/config/runtime", { method: "PUT", body: JSON.stringify({ policy: "assistant-approve", memoryAutoLearn: false }) });
  const escalated = await waitFor(async () => (await request(base, `/api/sessions/${session.id}`)).approvals.find((item) => item.reviewReason));
  assert.match(escalated.reviewReason, /未配置模型/);
  await assert.rejects(fs.access(path.join(dataRoot, "workspace", "switched.txt")));
  await request(base, "/api/config/runtime", { method: "PUT", body: JSON.stringify({ policy: "allow-all" }) });
  await waitFor(async () => (await request(base, `/api/sessions/${session.id}`)).status === "idle");
  assert.equal(await fs.readFile(path.join(dataRoot, "workspace", "switched.txt"), "utf8"), "approved");
  const afterSwitch = await request(base, `/api/sessions/${session.id}`);
  assert.equal(afterSwitch.approvals.length, 0);
  assert.equal(afterSwitch.messages.filter((item) => item.toolName === "write_file" && item.status === "completed").length, 1);
  assert.deepEqual(await request(base, "/api/config/runtime"), { policy: "allow-all", memoryAutoLearn: false });
  const persistedConfig = await fs.readFile(path.join(dataRoot, ".env"), "utf8");
  assert.match(persistedConfig, /TOOL_POLICY="allow-all"/);
  assert.match(persistedConfig, /MEMORY_AUTO_LEARN="false"/);

  const factsBefore = (await request(base, "/api/memory/stats")).facts;
  await request(base, `/api/sessions/${session.id}/tasks`, { method: "POST", body: JSON.stringify({ text: "我喜欢长篇说明" }) });
  await waitFor(async () => (await request(base, `/api/sessions/${session.id}`)).status === "idle");
  assert.equal((await request(base, "/api/memory/stats")).facts, factsBefore, "disabled auto-learning must not add facts");
  const relationId = manualMemory.relations[0].id;
  await request(base, `/api/knowledge-graph/relations/${relationId}`, { method: "DELETE" });
  assert.equal((await request(base, "/api/knowledge-graph")).relations.some((item) => item.id === relationId), false);
  await request(base, "/api/config/runtime", { method: "PUT", body: JSON.stringify({ policy: "always-ask" }) });

  await request(base, "/api/knowledge/memory", { method: "PUT", body: JSON.stringify({ content: "# Memory\n\nTest fact" }) });
  assert.match((await request(base, "/api/knowledge")).memory, /Test fact/);

  const schedule = await request(base, "/api/schedules", { method: "POST", body: JSON.stringify({ name: "job", prompt: "hello", intervalMinutes: 10, sessionId: session.id }) });
  assert.equal((await request(base, "/api/schedules")).length, 1);
  await request(base, `/api/schedules/${schedule.id}`, { method: "DELETE" });
  assert.equal((await request(base, "/api/schedules")).length, 0);

  const initialConfig = await request(base, "/api/config/model");
  assert.equal(initialConfig.apiKeyConfigured, false);
  const savedConfig = await request(base, "/api/config/model", {
    method: "PUT",
    body: JSON.stringify({ baseUrl: "https://provider.example/v1", model: "test-model", apiKey: "test-secret-value" })
  });
  assert.equal(savedConfig.modelConfigured, true);
  assert.equal(JSON.stringify(savedConfig).includes("test-secret-value"), false);
  assert.deepEqual(await request(base, "/api/config/model"), { baseUrl: "https://provider.example/v1", model: "test-model", embeddingBaseUrl: "", embeddingModel: "", embeddingDimensions: "", embeddingFormat: "auto", embeddingApiKeyConfigured: true, embeddingApiKeySeparateConfigured: false, amapApiKeyConfigured: false, bochaApiKeyConfigured: false, policy: "always-ask", apiKeyConfigured: true });

  await request(base, `/api/sessions/${session.id}`, { method: "DELETE" });
  assert.equal((await request(base, "/api/sessions")).some((item) => item.id === session.id), false);
  await assert.rejects(fs.access(path.join(dataRoot, "traces", `${session.id}.jsonl`)));
  await assert.rejects(request(base, `/api/sessions/${session.id}`), /session not found/);
});

async function request(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, { headers: { "content-type": "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function waitFor(check, timeout = 3000, diagnostic = () => "") {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const result = await check(); if (result) return result; } catch { }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`condition timed out\n${diagnostic()}`);
}
