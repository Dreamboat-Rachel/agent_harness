import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Store, hydrateSessions } from "./store.mjs";
import { KnowledgeBase } from "./knowledge.mjs";
import { McpManager } from "./mcp.mjs";
import { compactionCutoff } from "./runtime-utils.mjs";
import { MemoryEngine } from "./memory-engine.mjs";
import { autoApproveTool, loadEnvFile, publicModelConfig, saveModelConfig, saveRuntimeConfig } from "./model-config.mjs";
import { reviewApproval } from "./approval.mjs";
import { readCompletionStream } from "./openai-stream.mjs";
import { EmbeddingClient } from "./embeddings.mjs";
import { CommandSandbox } from "./command-sandbox.mjs";
import { BochaSearchClient } from "./web-search.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.resolve(process.env.PENGUIN_ENV_FILE || path.join(ROOT, ".env"));
await loadEnvFile(ENV_FILE);
const DATA_ROOT = path.resolve(process.env.PENGUIN_HOME || path.join(ROOT, "data"));
const TRACE_ROOT = path.join(DATA_ROOT, "traces");
const WORKSPACE_ROOT = path.resolve(process.env.PENGUIN_WORKSPACE || path.join(DATA_ROOT, "workspace"));
const PUBLIC_ROOT = path.join(ROOT, "public");
const MARKED_BROWSER_FILE = path.join(ROOT, "node_modules", "marked", "lib", "marked.esm.js");
const PORT = Number(process.env.PORT || 4371);
const HOST = process.env.HOST || "127.0.0.1";
let POLICY = process.env.TOOL_POLICY || "always-ask";
const CONTEXT_LIMIT = Number(process.env.CONTEXT_CHAR_LIMIT || 60000);
const MAX_TURNS = Number(process.env.MAX_TURNS || 20);
let MEMORY_AUTO_LEARN = process.env.MEMORY_AUTO_LEARN !== "false";

await fs.mkdir(TRACE_ROOT, { recursive: true });
await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
const WORKSPACE_REAL_ROOT = await fs.realpath(WORKSPACE_ROOT);
const store = new Store(DATA_ROOT);
await store.importLegacyTraces(TRACE_ROOT);
const knowledge = new KnowledgeBase(DATA_ROOT);
await knowledge.init();
const mcp = new McpManager(DATA_ROOT);
await mcp.init();
const commandSandbox = new CommandSandbox({
  workspaceRoot: WORKSPACE_ROOT,
  network: process.env.SANDBOX_NETWORK || "none"
});
await commandSandbox.init();

function createChannel() {
  let sequence = 0;
  const events = [];
  const listeners = new Set();
  return {
    publish(type, payload) {
      const event = { id: String(++sequence), type, payload };
      events.push(event);
      if (events.length > 2000) events.shift();
      for (const listener of listeners) listener(event);
    },
    subscribe(listener, afterId = 0) {
      for (const event of events) if (Number(event.id) > Number(afterId)) listener(event);
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

const sessions = hydrateSessions(store, createChannel, TRACE_ROOT);

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function safeWorkspacePath(input, { write = false } = {}) {
  const raw = String(input || "");
  if (!raw || raw.includes("\0") || /^\\\\[.?]\\/.test(raw)) throw new Error("invalid workspace path");
  const resolved = path.resolve(WORKSPACE_ROOT, raw);
  if (!inside(WORKSPACE_ROOT, resolved)) throw new Error("path escapes the workspace");
  if (!write) {
    const real = await fs.realpath(resolved);
    if (!inside(WORKSPACE_REAL_ROOT, real)) throw new Error("path escapes the workspace through a link");
    return real;
  }
  let ancestor = resolved;
  while (true) {
    try { ancestor = await fs.realpath(ancestor); break; }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  if (!inside(WORKSPACE_REAL_ROOT, ancestor)) throw new Error("path escapes the workspace through a link");
  return resolved;
}

function inside(root, target) { return target === root || target.startsWith(`${root}${path.sep}`); }

async function trace(session, record) {
  await fs.appendFile(session.tracePath, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`, "utf8");
}

function emit(session, type, payload) {
  const message = { type, ...payload };
  session.channel.publish(type, message);
  void trace(session, { type: "event", payload: message });
}

function persist(session) { store.updateSession(session); }

function addMessage(session, role, content, extra = {}) {
  const { id = randomUUID(), ...metadata } = extra;
  const message = { id, role, content: String(content ?? ""), createdAt: new Date().toISOString(), ...metadata };
  session.messages.push(message);
  store.insertMessage(session.id, message);
  emit(session, "message", { message });
  void trace(session, { type: "message", payload: message });
  return message;
}

function createSession({ title = "New Session" } = {}) {
  const now = new Date().toISOString();
  const id = `session-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const session = {
    id, title, status: "idle", messages: [], history: [], summary: "", approvals: new Map(),
    channel: createChannel(), abort: null, tracePath: path.join(TRACE_ROOT, `${id}.jsonl`), createdAt: now, updatedAt: now
  };
  sessions.set(id, session);
  store.insertSession(session);
  void trace(session, { type: "session_meta", payload: { sessionId: id, workspace: WORKSPACE_ROOT } });
  return session;
}

function publicSession(session, detail = true) {
  return {
    id: session.id, title: session.title, status: session.status, createdAt: session.createdAt, updatedAt: session.updatedAt,
    summary: session.summary,
    ...(detail ? { messages: session.messages, approvals: [...session.approvals.values()].map(({ resolve, ...item }) => item), subagents: store.subagents(session.id) } : {})
  };
}

function fn(name, description, properties, required = []) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false } } };
}

function stringProp() { return { type: "string" }; }
function numberProp() { return { type: "number" }; }

function builtInToolDefinitions() {
  return [
    fn("read_file", "Read a UTF-8 file inside the workspace.", { path: stringProp() }, ["path"]),
    fn("write_file", "Write a UTF-8 file inside the workspace.", { path: stringProp(), content: stringProp() }, ["path", "content"]),
    fn("run_command", "Run Linux Bash inside a bubblewrap sandbox. The host workspace is /workspace; other host paths are not mounted, network is disabled by default. Use python3. PowerShell and Windows executables are unavailable.", { command: stringProp() }, ["command"]),
    fn("web_search", "Search the live web with Bocha. Use this for current news, schedules, recent facts, or information that requires internet access. Results include source URLs; cite those sources in the answer.", {
      query: { type: "string", description: "Concise web search query" },
      summary: { type: "boolean", description: "Ask Bocha to summarize each result; defaults to true" },
      freshness: { type: "string", enum: ["noLimit", "oneDay", "oneWeek", "oneMonth", "oneYear"], description: "Freshness filter" },
      count: { type: "integer", minimum: 1, maximum: 50, description: "Number of results; defaults to 10" }
    }, ["query"]),
    fn("read_memory", "Read the durable memory document shared across sessions.", {}),
    fn("write_memory", "Replace durable memory with updated Markdown. Never store secrets.", { content: stringProp() }, ["content"]),
    fn("search_memory", "Search semantic memories and related knowledge graph context.", { query: stringProp(), limit: numberProp() }, ["query"]),
    fn("remember_fact", "Store one stable fact, preference, decision or project constraint in semantic memory. Never store secrets.", { content: stringProp(), kind: { type: "string", enum: ["preference", "profile", "project", "decision", "constraint", "fact"] }, subject: stringProp(), predicate: stringProp(), object: stringProp() }, ["content"]),
    fn("query_knowledge_graph", "Query knowledge graph entities and relations.", { query: stringProp(), limit: numberProp() }),
    fn("list_skills", "List installed skills and their descriptions.", {}),
    fn("read_skill", "Read one installed SKILL.md.", { name: stringProp() }, ["name"]),
    fn("run_subagent", "Run an isolated child model context for a focused task. It shares the workspace but cannot spawn children.", { prompt: stringProp() }, ["prompt"])
  ];
}

function toolDefinitions() { return [...builtInToolDefinitions(), ...mcp.definitions()]; }

class ModelClient {
  constructor() {
    this.baseUrl = process.env.LLM_BASE_URL || "";
    this.apiKey = process.env.LLM_API_KEY || "";
    this.model = process.env.LLM_MODEL || "";
  }

  get configured() { return Boolean(this.baseUrl && this.model); }

  configure({ baseUrl, apiKey, model }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(messages, signal, { tools = toolDefinitions(), systemPrompt = "", onToken } = {}) {
    if (!this.configured) return this.demo(messages, tools, onToken);
    const body = { model: this.model, messages: [...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []), ...messages], stream: false };
    if (onToken) body.stream = true;
    if (tools.length) Object.assign(body, { tools, tool_choice: "auto" });
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`model request failed: ${response.status} ${await response.text()}`);
    if (onToken && response.headers.get("content-type")?.includes("text/event-stream")) return await readCompletionStream(response.body, onToken);
    const choice = (await response.json()).choices?.[0]?.message || {};
    return { content: choice.content || "", toolCalls: (choice.tool_calls || []).map((call) => ({ id: call.id || randomUUID(), name: call.function?.name, arguments: call.function?.arguments || "{}" })) };
  }

  demo(messages, tools, onToken) {
    const last = String(messages.at(-1)?.content || "");
    const rules = [
      [/^读取(?:文件)?\s+(.+)$/i, "read_file", (m) => ({ path: m[1].trim() })],
      [/^写入(?:文件)?\s+(\S+)\s+([\s\S]+)$/i, "write_file", (m) => ({ path: m[1], content: m[2] })],
      [/^执行命令\s+([\s\S]+)$/i, "run_command", (m) => ({ command: m[1] })],
      [/^(?:联网查询|搜索网页)\s+([\s\S]+)$/i, "web_search", (m) => ({ query: m[1].trim(), summary: true, freshness: "noLimit", count: 10 })],
      [/^记住\s+([\s\S]+)$/i, "remember_fact", (m) => ({ content: m[1], kind: "fact", subject: "user", predicate: "wants_remembered", object: m[1] })],
      [/^读取记忆$/i, "read_memory", () => ({})],
      [/^读取技能\s+(\S+)$/i, "read_skill", (m) => ({ name: m[1] })],
      [/^子代理\s+([\s\S]+)$/i, "run_subagent", (m) => ({ prompt: m[1] })]
    ];
    for (const [pattern, name, args] of rules) {
      const match = pattern.exec(last.trim());
      if (match && tools.some((tool) => tool.function.name === name)) return { content: "", toolCalls: [{ id: randomUUID(), name, arguments: JSON.stringify(args(match)) }] };
    }
    if (messages.at(-1)?.role === "tool") {
      const content = `工具执行完成：\n\n${last}`;
      onToken?.(content);
      return { content, toolCalls: [] };
    }
    const content = `演示模式已收到：${last}\n\n打开右侧“配置”页签，填写模型接口、模型名称和 API Key，即可连接真实模型。`;
    onToken?.(content);
    return { content, toolCalls: [] };
  }

  async summarize(history, signal) {
    if (!this.configured) return history.filter((item) => item.role === "user" || item.role === "assistant").map((item) => `${item.role}: ${String(item.content || "").slice(0, 500)}`).join("\n").slice(-10000);
    const result = await this.complete([{ role: "user", content: `Summarize this conversation for continuation. Preserve decisions, constraints, file changes and unresolved work.\n\n${JSON.stringify(history)}` }], signal, { tools: [], systemPrompt: "Return a concise factual context summary only." });
    if (!result.content.trim()) throw new Error("context summary was empty");
    return result.content.trim();
  }

  async extractMemories(text) {
    if (!this.configured) return null;
    const result = await this.complete([{ role: "user", content: String(text).slice(0, 30000) }], AbortSignal.timeout(45000), {
      tools: [],
      systemPrompt: `Extract only stable, reusable information explicitly stated in this user message. Exclude secrets, credentials, transient requests, questions, greetings and tool output. Do not infer a preference or project fact from a one-off task. Return empty arrays if there is no durable information. Use consistent subjects and predicates across paraphrases. Every relation must reuse the exact subject, predicate and object of a supported fact as source, predicate and target. Return JSON only with this shape:\n{"facts":[{"kind":"preference|profile|project|decision|constraint|fact","subject":"...","predicate":"...","object":"...","content":"plain factual sentence","confidence":0.0}],"relations":[{"source":"...","sourceType":"person|project|technology|concept","predicate":"...","target":"...","targetType":"...","targetIsValue":false,"confidence":0.0}]}`
    });
    return parseJsonObject(result.content);
  }
}

const model = new ModelClient();
const embeddings = new EmbeddingClient({ baseUrl: model.baseUrl, apiKey: model.apiKey });
const webSearch = new BochaSearchClient();
const memoryEngine = new MemoryEngine(store, { extractor: (text) => model.extractMemories(text), embedder: embeddings });

function toolPermission(name) {
  if (["read_file", "web_search", "read_memory", "search_memory", "query_knowledge_graph", "list_skills", "read_skill"].includes(name)) return "r";
  const entry = mcp.tools.get(name);
  return entry?.tool?.annotations?.readOnlyHint === true ? "r" : "w";
}

async function waitForApproval(session, call, signal) {
  if (signal?.aborted) return "aborted";
  if (autoApproveTool(POLICY, call.name, toolPermission(call.name))) return "allow";
  if (POLICY === "deny-all") return "deny";
  if (POLICY === "assistant-approve") {
    const policyBeforeReview = POLICY;
    const request = [...session.history].reverse().find((item) => item.role === "user")?.content || "";
    const review = await reviewApproval({ complete: model.complete.bind(model), configured: model.configured, request, call, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (signal?.aborted) return "aborted";
    if (POLICY !== policyBeforeReview) return waitForApproval(session, call, signal);
    emit(session, "approval_review", { id: call.id, name: call.name, ...review });
    await trace(session, { type: "approval_review", payload: { id: call.id, name: call.name, ...review } });
    if (review.decision !== "ask") return review.decision;
    call = { ...call, reviewReason: review.reason };
  }
  const decision = await new Promise((resolve) => {
    let settled = false;
    const finish = (decision) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      session.approvals.delete(call.id);
      emit(session, "approval_resolved", { id: call.id });
      resolve(decision);
    };
    const onAbort = () => finish("aborted");
    if (signal?.aborted) return finish("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });
    session.approvals.set(call.id, { id: call.id, name: call.name, arguments: call.arguments, reviewReason: call.reviewReason, resolve: finish });
    emit(session, "approval_request", { approval: { id: call.id, name: call.name, arguments: call.arguments, reviewReason: call.reviewReason } });
  });
  return decision === "retry" ? waitForApproval(session, call, signal) : decision;
}

function applyPolicy(policy) {
  if (policy === POLICY) return;
  POLICY = policy;
  for (const session of sessions.values()) for (const approval of [...session.approvals.values()]) approval.resolve("retry");
}

async function runSubagent(session, prompt, signal) {
  const now = new Date().toISOString();
  const child = { id: `subagent-${Date.now()}-${randomUUID().slice(0, 8)}`, parentSessionId: session.id, status: "running", prompt, result: "", createdAt: now, updatedAt: now };
  store.insertSubagent(child);
  emit(session, "subagent_state", { subagent: child });
  try {
    const result = await model.complete([{ role: "user", content: prompt }], signal, { tools: [], systemPrompt: `${await knowledge.systemPrompt()}\n\nYou are a focused child agent. Return findings to the parent; do not claim actions you could not perform.` });
    child.result = result.content || "Subagent returned no text.";
    child.status = "completed";
    return child.result;
  } catch (error) {
    child.status = "failed";
    child.result = error.message;
    throw error;
  } finally {
    store.updateSubagent(child);
    emit(session, "subagent_state", { subagent: child });
  }
}

async function executeTool(session, name, args, signal) {
  if (name === "read_file") return await fs.readFile(await safeWorkspacePath(args.path), "utf8");
  if (name === "write_file") {
    const file = await safeWorkspacePath(args.path, { write: true });
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, String(args.content ?? ""), "utf8");
    return `wrote ${args.path}`;
  }
  if (name === "run_command") return await commandSandbox.run(String(args.command || ""), signal);
  if (name === "web_search") return JSON.stringify(await webSearch.search(args, signal), null, 2);
  if (name === "read_memory") return await knowledge.memory();
  if (name === "write_memory") return await knowledge.writeMemory(args.content);
  if (name === "search_memory") return JSON.stringify(await memoryEngine.search(String(args.query || ""), args.limit || 8), null, 2);
  if (name === "remember_fact") return JSON.stringify(await memoryEngine.rememberFact(args, { sessionId: session.id }), null, 2);
  if (name === "query_knowledge_graph") return JSON.stringify(memoryEngine.graph(String(args.query || ""), args.limit || 30), null, 2);
  if (name === "list_skills") return JSON.stringify(await knowledge.listSkills(), null, 2);
  if (name === "read_skill") return await knowledge.readSkill(args.name);
  if (name === "run_subagent") return await runSubagent(session, String(args.prompt || ""), signal);
  if (name.startsWith("mcp__")) return await mcp.call(name, args);
  throw new Error(`unknown tool: ${name}`);
}

async function compactIfNeeded(session) {
  if (JSON.stringify(session.history).length <= CONTEXT_LIMIT) return;
  const cutoff = compactionCutoff(session.history, 8);
  const keep = session.history.slice(cutoff);
  const old = session.history.slice(0, cutoff);
  if (old.length === 0) return;
  emit(session, "compaction", { status: "started" });
  const summary = await model.summarize(old, session.abort.signal);
  session.summary = [session.summary, summary].filter(Boolean).join("\n\n").slice(-20000);
  session.history = [{ role: "user", content: `[context_summary]\n${session.summary}` }, ...keep];
  persist(session);
  emit(session, "compaction", { status: "completed", summary: session.summary });
  await trace(session, { type: "compaction", payload: { summary: session.summary } });
}

function toolOutput(session, call, output, status) {
  addMessage(session, "tool", output, { toolCallId: call.id, toolName: call.name, status });
  return { role: "tool", tool_call_id: call.id, content: String(output) };
}

async function runSession(session, text, { sender = "user" } = {}) {
  if (session.status === "running") throw new Error("session is already running");
  session.status = "running";
  session.abort = new AbortController();
  persist(session);
  emit(session, "task_state", { status: "running" });
  addMessage(session, "user", text, { sender });
  session.history.push({ role: "user", content: text });
  if (session.title === "New Session") session.title = text.slice(0, 42);
  persist(session);
  let memoryContext = "";
  let finalAssistantText = "";
  let explicitMemoryWrite = false;
  let interruptedStream = null;
  try {
    const recalled = await memoryEngine.recall(text, { limit: 8 });
    memoryContext = recalled.context;
    emit(session, "memory_recall", { facts: recalled.facts.length, relations: recalled.graph.relations.length });
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      await compactIfNeeded(session);
      emit(session, "request_begin", { turn: turn + 1 });
      let streamedContent = "";
      let streamedId = null;
      const result = await model.complete(session.history, session.abort.signal, {
        systemPrompt: await knowledge.systemPrompt(memoryContext),
        onToken: (delta) => {
          if (!streamedId) streamedId = randomUUID();
          streamedContent += delta;
          interruptedStream = { id: streamedId, content: streamedContent };
          emit(session, "assistant_delta", { id: streamedId, delta });
        }
      });
      const assistantHistory = { role: "assistant", content: result.content || null };
      if (result.toolCalls.length) assistantHistory.tool_calls = result.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }));
      if (result.content) {
        addMessage(session, "assistant", result.content, streamedId ? { id: streamedId } : {});
        finalAssistantText = result.content;
      }
      interruptedStream = null;
      if (result.content || result.toolCalls.length) session.history.push(assistantHistory);
      persist(session);
      if (result.toolCalls.length === 0) break;
      const outputs = await Promise.all(result.toolCalls.map(async (call) => {
        let args;
        try { args = JSON.parse(call.arguments); } catch { args = {}; }
        emit(session, "tool_call", { call: { ...call, arguments: args } });
        if (call.name === "remember_fact" || call.name === "write_memory") explicitMemoryWrite = true;
        const decision = await waitForApproval(session, { ...call, arguments: args }, session.abort.signal);
        if (decision !== "allow") return toolOutput(session, call, `tool denied (${decision})`, decision === "aborted" ? "aborted" : "denied");
        try { return toolOutput(session, call, await executeTool(session, call.name, args, session.abort.signal), "completed"); }
        catch (error) { return toolOutput(session, call, `[tool error] ${error.message}`, "error"); }
      }));
      session.history.push(...outputs);
      persist(session);
      if (session.abort.signal.aborted) throw new DOMException("Aborted", "AbortError");
    }
    if (MEMORY_AUTO_LEARN && finalAssistantText && !explicitMemoryWrite) {
      const learned = await memoryEngine.learn({ text, sessionId: session.id });
      emit(session, "memory_update", { facts: learned.facts.length, entities: learned.entities.length, relations: learned.relations.length });
    }
  } catch (error) {
    if (interruptedStream?.content) addMessage(session, "assistant", interruptedStream.content, { id: interruptedStream.id, incomplete: true });
    addMessage(session, "system", error.name === "AbortError" ? "任务已停止" : `[error] ${error.message}`);
  } finally {
    session.status = "idle";
    session.abort = null;
    for (const approval of session.approvals.values()) approval.resolve("deny");
    session.approvals.clear();
    persist(session);
    emit(session, "task_state", { status: "idle" });
  }
}

async function schedulerTick() {
  const now = Date.now();
  for (const schedule of store.schedules()) {
    if (!schedule.enabled || Date.parse(schedule.nextRunAt) > now) continue;
    let session = schedule.sessionId ? sessions.get(schedule.sessionId) : null;
    if (!session) session = createSession({ title: schedule.name });
    if (session.status === "running") continue;
    const firedAt = new Date().toISOString();
    store.updateScheduleRun(schedule.id, new Date(now + schedule.intervalMinutes * 60000).toISOString(), firedAt);
    void runSession(session, `[scheduled:${schedule.name}]\n${schedule.prompt}`, { sender: "scheduler" });
  }
}

setInterval(() => void schedulerTick(), 30000).unref();

function serveStatic(res, pathname) {
  if (pathname === "/vendor/marked.esm.js") {
    return fs.readFile(MARKED_BROWSER_FILE).then((body) => {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400" });
      res.end(body);
    }).catch(() => json(res, 404, { error: "not found" }));
  }
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = path.resolve(PUBLIC_ROOT, relative);
  if (file !== PUBLIC_ROOT && !file.startsWith(`${PUBLIC_ROOT}${path.sep}`)) return json(res, 404, { error: "not found" });
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
  fs.readFile(file).then((body) => { res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" }); res.end(body); }).catch(() => json(res, 404, { error: "not found" }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    if (!url.pathname.startsWith("/api/")) return serveStatic(res, url.pathname);
    if (req.method === "PUT" && url.pathname === "/api/config/runtime") {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return json(res, 403, { error: "跨站配置请求已拒绝" });
      const settings = await saveRuntimeConfig(ENV_FILE, await readBody(req), { policy: POLICY, memoryAutoLearn: MEMORY_AUTO_LEARN });
      MEMORY_AUTO_LEARN = settings.memoryAutoLearn;
      applyPolicy(settings.policy);
      return json(res, 200, settings);
    }
    if (req.method === "GET" && url.pathname === "/api/config/runtime") return json(res, 200, { policy: POLICY, memoryAutoLearn: MEMORY_AUTO_LEARN });
    if (req.method === "GET" && url.pathname === "/api/capabilities") return json(res, 200, { modelConfigured: model.configured, policy: POLICY, workspace: WORKSPACE_ROOT, persistence: "sqlite+jsonl", memory: memoryEngine.status(), sandbox: commandSandbox.status(), webSearch: webSearch.status(), features: ["context-compaction", "langgraph-memory", "vector-memory", "knowledge-graph", "bubblewrap-sandbox", "skills", "subagents", "scheduler", "mcp-http", "amap-maps-mcp", "bocha-web-search"] });
    if (req.method === "GET" && url.pathname === "/api/config/model") return json(res, 200, await publicModelConfig(ENV_FILE, { ...model, embeddingBaseUrl: embeddings.baseUrl === model.baseUrl ? "" : embeddings.baseUrl, embeddingApiKey: embeddings.apiKey === model.apiKey ? "" : embeddings.apiKey, embeddingModel: embeddings.model, embeddingDimensions: embeddings.dimensions || "", embeddingFormat: embeddings.format, bochaApiKey: webSearch.apiKey, policy: POLICY }));
    if (req.method === "PUT" && url.pathname === "/api/config/model") {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return json(res, 403, { error: "跨站配置请求已拒绝" });
      const saved = await saveModelConfig(ENV_FILE, await readBody(req), { ...model, embeddingBaseUrl: embeddings.baseUrl === model.baseUrl ? "" : embeddings.baseUrl, embeddingApiKey: embeddings.apiKey === model.apiKey ? "" : embeddings.apiKey, embeddingModel: embeddings.model, embeddingDimensions: embeddings.dimensions || "", embeddingFormat: embeddings.format, bochaApiKey: webSearch.apiKey, policy: POLICY });
      model.configure(saved);
      embeddings.configure(saved);
      webSearch.configure(saved);
      mcp.configureEnvironment({ AMAP_MAPS_API_KEY: saved.amapApiKey });
      await mcp.init();
      applyPolicy(saved.policy);
      return json(res, 200, { baseUrl: saved.baseUrl, model: saved.model, policy: saved.policy, apiKeyConfigured: saved.apiKeyConfigured, embeddingBaseUrl: saved.embeddingBaseUrl, embeddingModel: saved.embeddingModel, embeddingDimensions: saved.embeddingDimensions, embeddingFormat: saved.embeddingFormat, embeddingApiKeyConfigured: saved.embeddingApiKeyConfigured, embeddingApiKeySeparateConfigured: saved.embeddingApiKeySeparateConfigured, amapApiKeyConfigured: saved.amapApiKeyConfigured, bochaApiKeyConfigured: saved.bochaApiKeyConfigured, vectorConfigured: embeddings.configured, modelConfigured: model.configured });
    }
    if (req.method === "GET" && url.pathname === "/api/knowledge") return json(res, 200, { memory: await knowledge.memory(), skills: await knowledge.listSkills(), stats: store.memoryStats() });
    if (req.method === "PUT" && url.pathname === "/api/knowledge/memory") return json(res, 200, { result: await knowledge.writeMemory((await readBody(req)).content) });
    if (req.method === "GET" && url.pathname === "/api/memory") return json(res, 200, await memoryEngine.search(url.searchParams.get("query") || "", url.searchParams.get("limit") || 30));
    if (req.method === "GET" && url.pathname === "/api/memory/stats") return json(res, 200, store.memoryStats());
    if (req.method === "POST" && url.pathname === "/api/memory/facts") {
      const stored = await memoryEngine.rememberFact(await readBody(req));
      return json(res, 201, stored);
    }
    if (req.method === "DELETE" && parts[1] === "memory" && parts[2] === "facts" && parts[3]) {
      const deleted = store.deleteMemoryFact(parts[3]);
      return json(res, deleted ? 200 : 404, { deleted });
    }
    if (req.method === "GET" && url.pathname === "/api/knowledge-graph") return json(res, 200, memoryEngine.graph(url.searchParams.get("query") || "", url.searchParams.get("limit") || 100));
    if (req.method === "DELETE" && parts[1] === "knowledge-graph" && parts[2] === "relations" && parts[3]) {
      const deleted = store.deleteRelation(parts[3]);
      return json(res, deleted ? 200 : 404, { deleted });
    }
    if (req.method === "GET" && url.pathname === "/api/mcp") return json(res, 200, mcp.status());
    if (req.method === "POST" && url.pathname === "/api/mcp/refresh") { await mcp.init(); return json(res, 200, mcp.status()); }
    if (req.method === "GET" && url.pathname === "/api/schedules") return json(res, 200, store.schedules());
    if (req.method === "POST" && url.pathname === "/api/schedules") {
      const body = await readBody(req);
      const intervalMinutes = Number(body.intervalMinutes);
      if (!body.name?.trim() || !body.prompt?.trim() || !Number.isFinite(intervalMinutes) || intervalMinutes < 1) return json(res, 400, { error: "name, prompt and intervalMinutes >= 1 are required" });
      const now = new Date();
      const row = { id: randomUUID(), name: body.name.trim(), prompt: body.prompt.trim(), intervalMinutes, sessionId: body.sessionId || null, enabled: true, nextRunAt: new Date(now.getTime() + intervalMinutes * 60000).toISOString(), lastRunAt: null, createdAt: now.toISOString() };
      store.insertSchedule(row);
      return json(res, 201, row);
    }
    if (req.method === "DELETE" && parts[1] === "schedules" && parts[2]) return json(res, store.deleteSchedule(parts[2]) ? 200 : 404, { deleted: true });
    if (req.method === "GET" && url.pathname === "/api/sessions") return json(res, 200, [...sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((session) => publicSession(session, false)));
    if (req.method === "POST" && url.pathname === "/api/sessions") return json(res, 201, publicSession(createSession()));
    if (parts[0] !== "api" || parts[1] !== "sessions" || !parts[2]) return json(res, 404, { error: "not found" });
    const session = sessions.get(parts[2]);
    if (!session) return json(res, 404, { error: "session not found" });
    if (req.method === "GET" && parts[3] === "stream") {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
      const send = (event) => res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
      const unsubscribe = session.channel.subscribe(send, req.headers["last-event-id"] || 0);
      const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15000);
      req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
      return;
    }
    if (req.method === "GET" && parts.length === 3) return json(res, 200, publicSession(session));
    if (req.method === "DELETE" && parts.length === 3) {
      if (session.status === "running") return json(res, 409, { error: "请先停止正在运行的会话，再删除" });
      await fs.rm(session.tracePath, { force: true });
      store.deleteSession(session.id);
      sessions.delete(session.id);
      return json(res, 200, { deleted: true });
    }
    if (req.method === "POST" && parts[3] === "tasks") {
      const body = await readBody(req);
      if (typeof body.text !== "string" || !body.text.trim()) return json(res, 400, { error: "text is required" });
      if (session.status === "running") return json(res, 409, { error: "session is busy" });
      void runSession(session, body.text.trim());
      return json(res, 202, { accepted: true, sessionId: session.id });
    }
    if (req.method === "POST" && parts[3] === "approvals") {
      const body = await readBody(req);
      const approval = session.approvals.get(body.id);
      if (!approval) return json(res, 404, { error: "approval not found" });
      approval.resolve(body.decision === "allow" ? "allow" : "deny");
      session.approvals.delete(body.id);
      return json(res, 202, { accepted: true });
    }
    if (req.method === "POST" && parts[3] === "stop") {
      session.abort?.abort();
      for (const approval of session.approvals.values()) approval.resolve("aborted");
      session.approvals.clear();
      return json(res, 202, { accepted: true });
    }
    return json(res, 404, { error: "not found" });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => console.log(`Penguin replica listening on http://${HOST}:${PORT}`));

function parseJsonObject(value) {
  const text = String(value || "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)?.[1] || text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("memory extraction did not return JSON");
  return JSON.parse(fenced.slice(start, end + 1));
}

