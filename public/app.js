import { renderMarkdown } from "./markdown.js";

const state = {
  sessions: [], current: null, stream: null, capabilities: null,
  knowledge: { memory: "", skills: [], stats: {} }, memorySearch: { facts: [], graph: { entities: [], relations: [] } },
  graph: { entities: [], relations: [] }, schedules: [], mcp: [],
  modelConfig: { baseUrl: "", model: "", embeddingBaseUrl: "", embeddingModel: "", embeddingDimensions: "", embeddingFormat: "auto", policy: "always-ask", apiKeyConfigured: false, embeddingApiKeyConfigured: false, embeddingApiKeySeparateConfigured: false, amapApiKeyConfigured: false }
};

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function formatTime(value) {
  if (!value) return "尚未运行";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function notify(message, kind = "ok") {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = `toast show ${kind}`;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.className = "toast"; }, 2600);
}

function renderSessions() {
  $("sessions").innerHTML = state.sessions.length
    ? state.sessions.map((session) => `<div class="session-row ${session.id === state.current?.id ? "active" : ""}"><button type="button" class="session-item" data-session-id="${escapeHtml(session.id)}"><span>${escapeHtml(session.title)}</span><small><i class="state-dot ${escapeHtml(session.status)}"></i>${escapeHtml(session.status)}</small></button><button type="button" class="session-delete" title="删除会话" aria-label="删除会话：${escapeHtml(session.title)}" data-delete-session="${escapeHtml(session.id)}">×</button></div>`).join("")
    : '<div class="panel-empty">暂无会话</div>';
  document.querySelectorAll("[data-session-id]").forEach((element) => element.addEventListener("click", () => selectSession(element.dataset.sessionId)));
  document.querySelectorAll("[data-delete-session]").forEach((button) => button.addEventListener("click", () => deleteSession(button.dataset.deleteSession)));
}

function renderMessages() {
  const container = $("messages");
  const followOutput = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  const messages = state.current?.messages || [];
  container.innerHTML = messages.length
    ? messages.map((message) => `<article class="message ${escapeHtml(message.role)}"><div class="avatar">${message.role === "user" ? "你" : message.role === "tool" ? "T" : message.role === "system" ? "!" : "P"}</div><div class="message-body"><div class="message-meta">${escapeHtml(message.role)}${message.toolName ? ` · ${escapeHtml(message.toolName)}` : ""}</div><div class="message-content ${message.role === "assistant" ? "markdown-content" : "plain-content"}">${message.role === "assistant" ? renderMarkdown(message.content) : escapeHtml(message.content)}</div></div></article>`).join("")
    : '<div class="empty">创建会话后发送一条消息开始运行。</div>';
  if (followOutput) container.scrollTop = container.scrollHeight;
}

function renderCurrent() {
  $("session-title").textContent = state.current?.title || "New Session";
  const status = state.current?.status || "idle";
  $("status").textContent = status;
  $("status").className = `status ${status}`;
  $("stop").disabled = status !== "running";
  $("input").disabled = !state.current;
  document.querySelector(".send-button").disabled = !state.current;
  $("input").placeholder = status === "running" ? "当前任务运行中…" : "输入任务，例如：读取 notes.txt 并总结";
  renderSessions();
  renderMessages();
  renderApprovals();
  renderSubagents();
}

function renderRuntime() {
  const info = state.capabilities;
  if (!info) return;
  $("approval-mode").value = info.policy;
  $("runtime-stats").innerHTML = [
    ["模型", info.modelConfigured ? "已连接" : "演示模式"],
    ["记忆检索", info.memory?.mode === "vector" ? `向量 · ${info.memory.model}${info.memory.format ? ` · ${info.memory.format}` : ""}` : info.memory?.mode === "degraded" ? "向量异常，已降级" : "词法降级"],
    ["命令沙箱", info.sandbox?.available ? `${info.sandbox.backend} · ${info.sandbox.network === "none" ? "禁网" : "联网"}` : "不可用 · 命令拒绝执行"],
    ["工具策略", info.policy],
    ["持久化", info.persistence],
    ["工作区", info.workspace]
  ].map(([label, value]) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  $("features").innerHTML = info.features.map((feature) => `<span class="tag">${escapeHtml(feature)}</span>`).join("");
}

function renderApprovals() {
  const approvals = state.current?.approvals || [];
  $("approvals").innerHTML = approvals.length
    ? approvals.map((approval) => `<div class="list-item approval"><div class="item-head"><strong>${escapeHtml(approval.name)}</strong><span class="warn-dot"></span></div><code>${escapeHtml(JSON.stringify(approval.arguments, null, 2))}</code>${approval.reviewReason ? `<p class="hint">${escapeHtml(approval.reviewReason)}</p>` : ""}<div class="approval-actions"><button class="allow" type="button" data-approval="${escapeHtml(approval.id)}" data-decision="allow">允许</button><button class="deny" type="button" data-approval="${escapeHtml(approval.id)}" data-decision="deny">拒绝</button></div></div>`).join("")
    : '<div class="panel-empty">暂无待审批操作</div>';
  document.querySelectorAll("[data-approval]").forEach((button) => button.addEventListener("click", () => decide(button.dataset.approval, button.dataset.decision)));
}

function renderKnowledge() {
  if (document.activeElement !== $("memory-editor")) $("memory-editor").value = state.knowledge.memory || "";
  const stats = state.knowledge.stats || {};
  $("memory-stats").innerHTML = [["事实", stats.facts || 0], ["实体", stats.entities || 0], ["关系", stats.relations || 0]]
    .map(([label, value]) => `<div class="memory-stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
  $("memory-facts").innerHTML = state.memorySearch.facts.length
    ? state.memorySearch.facts.map((fact) => `<div class="list-item memory-fact"><div class="item-head"><strong>${escapeHtml(fact.kind)}</strong><button class="delete-button" type="button" title="删除记忆" aria-label="删除记忆" data-delete-memory="${escapeHtml(fact.id)}">×</button></div><p>${escapeHtml(fact.content)}</p><small>置信度 ${Math.round(Number(fact.confidence) * 100)}% · 使用 ${fact.accessCount || 0} 次</small></div>`).join("")
    : '<div class="panel-empty">暂无匹配的结构化记忆</div>';
  document.querySelectorAll("[data-delete-memory]").forEach((button) => button.addEventListener("click", () => deleteMemory(button.dataset.deleteMemory)));
  $("skills").innerHTML = state.knowledge.skills.length
    ? state.knowledge.skills.map((skill) => `<div class="list-item"><div class="item-head"><strong>${escapeHtml(skill.name)}</strong><span class="ok-dot"></span></div><p>${escapeHtml(skill.description || "无描述")}</p></div>`).join("")
    : '<div class="panel-empty">尚未安装技能</div>';
}

function renderGraph() {
  const entities = state.graph.entities.slice(0, 24);
  const entityIds = new Set(entities.map((entity) => entity.id));
  const relations = state.graph.relations.filter((relation) => entityIds.has(relation.sourceEntityId) && entityIds.has(relation.targetEntityId)).slice(0, 48);
  $("graph-summary").textContent = `${state.graph.entities.length} 个实体 · ${state.graph.relations.length} 条关系`;
  if (!entities.length) {
    $("graph-canvas").innerHTML = '<div class="panel-empty">图谱为空。对话中使用“记住 …”或添加结构化记忆后会自动生成。</div>';
  } else {
    const width = 300; const height = 270; const cx = width / 2; const cy = height / 2; const radius = Math.min(100, 36 + entities.length * 4);
    const points = new Map(entities.map((entity, index) => [entity.id, { x: cx + Math.cos((index / entities.length) * Math.PI * 2 - Math.PI / 2) * radius, y: cy + Math.sin((index / entities.length) * Math.PI * 2 - Math.PI / 2) * radius }]));
    const lines = relations.map((relation) => { const source = points.get(relation.sourceEntityId); const target = points.get(relation.targetEntityId); return `<line class="graph-edge" x1="${source.x.toFixed(1)}" y1="${source.y.toFixed(1)}" x2="${target.x.toFixed(1)}" y2="${target.y.toFixed(1)}"><title>${escapeHtml(`${relation.source} ${relation.predicate} ${relation.target}`)}</title></line>`; }).join("");
    const nodes = entities.map((entity) => { const point = points.get(entity.id); const label = entity.name.length > 8 ? `${entity.name.slice(0, 8)}…` : entity.name; return `<g class="graph-node" transform="translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})"><circle r="12"></circle><text y="25">${escapeHtml(label)}</text><title>${escapeHtml(`${entity.name} · ${entity.type}`)}</title></g>`; }).join("");
    $("graph-canvas").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="知识图谱，共 ${entities.length} 个实体和 ${relations.length} 条可视关系"><title>知识图谱</title>${lines}${nodes}</svg>`;
  }
  $("graph-relations").innerHTML = state.graph.relations.length
    ? state.graph.relations.slice(0, 40).map((relation) => `<div class="list-item"><button class="delete-button" type="button" aria-label="删除关系" title="删除关系" data-delete-relation="${escapeHtml(relation.id)}">×</button><strong>${escapeHtml(relation.source)}</strong><span class="relation-arrow">${escapeHtml(relation.predicate)} →</span><strong>${escapeHtml(relation.target || relation.targetValue)}</strong></div>`).join("")
    : '<div class="panel-empty">暂无关系</div>';
  document.querySelectorAll("[data-delete-relation]").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("确定删除这条图谱关系吗？")) return;
    try { await api(`/knowledge-graph/relations/${button.dataset.deleteRelation}`, { method: "DELETE" }); await refreshMemory($("memory-search").value.trim()); notify("关系已删除"); }
    catch (error) { notify(error.message, "error"); }
  }));
}

function renderSubagents() {
  const agents = state.current?.subagents || [];
  $("subagents").innerHTML = agents.length
    ? agents.map((agent) => `<div class="list-item"><div class="item-head"><strong>${escapeHtml(agent.status)}</strong><small>${formatTime(agent.updatedAt)}</small></div><p>${escapeHtml(agent.prompt)}</p>${agent.result ? `<details><summary>查看结果</summary><pre>${escapeHtml(agent.result)}</pre></details>` : ""}</div>`).join("")
    : '<div class="panel-empty">暂无子代理运行记录</div>';
}

function renderSchedules() {
  $("schedules").innerHTML = state.schedules.length
    ? state.schedules.map((schedule) => `<div class="list-item"><div class="item-head"><strong>${escapeHtml(schedule.name)}</strong><button class="delete-button" type="button" title="删除定时任务" aria-label="删除定时任务" data-delete-schedule="${escapeHtml(schedule.id)}">×</button></div><p>${escapeHtml(schedule.prompt)}</p><small>每 ${schedule.intervalMinutes} 分钟 · 下次 ${formatTime(schedule.nextRunAt)}</small></div>`).join("")
    : '<div class="panel-empty">暂无定时任务</div>';
  document.querySelectorAll("[data-delete-schedule]").forEach((button) => button.addEventListener("click", () => deleteSchedule(button.dataset.deleteSchedule)));
}

function renderMcp() {
  $("mcp-servers").innerHTML = state.mcp.length
    ? state.mcp.map((server) => `<div class="list-item"><div class="item-head"><strong>${escapeHtml(server.name)}</strong><span class="${server.error ? "error-dot" : "ok-dot"}"></span></div><p>${escapeHtml(server.url)}</p><small>${server.error ? escapeHtml(server.error) : `${server.tools} 个工具`}</small></div>`).join("")
    : '<div class="panel-empty">尚未配置 MCP 服务</div>';
}

function connectStream() {
  state.stream?.close();
  if (!state.current) return;
  const sessionId = state.current.id;
  const stream = new EventSource(`/api/sessions/${sessionId}/stream`);
  state.stream = stream;
  stream.addEventListener("message", (event) => {
    if (state.current?.id !== sessionId) return;
    const message = JSON.parse(event.data).message;
    const existing = state.current.messages.findIndex((item) => item.id === message.id);
    if (existing >= 0) state.current.messages[existing] = message;
    else state.current.messages.push(message);
    renderMessages();
  });
  stream.addEventListener("assistant_delta", (event) => {
    if (state.current?.id !== sessionId) return;
    const { id, delta } = JSON.parse(event.data);
    let message = state.current.messages.find((item) => item.id === id);
    if (!message) {
      message = { id, role: "assistant", content: "", createdAt: new Date().toISOString() };
      state.current.messages.push(message);
    }
    message.content += delta;
    renderMessages();
  });
  stream.addEventListener("task_state", async (event) => {
    if (state.current?.id !== sessionId) return;
    state.current.status = JSON.parse(event.data).status;
    renderCurrent();
    if (state.current.status === "idle") await refreshSession(sessionId);
  });
  stream.addEventListener("approval_request", (event) => {
    if (state.current?.id !== sessionId) return;
    const approval = JSON.parse(event.data).approval;
    if (!state.current.approvals.some((item) => item.id === approval.id)) state.current.approvals.push(approval);
    renderApprovals();
  });
  stream.addEventListener("approval_resolved", (event) => {
    if (state.current?.id !== sessionId) return;
    const { id } = JSON.parse(event.data);
    state.current.approvals = state.current.approvals.filter((item) => item.id !== id);
    renderApprovals();
  });
  stream.addEventListener("approval_review", (event) => {
    if (state.current?.id !== sessionId) return;
    const review = JSON.parse(event.data);
    $("approval-review-status").textContent = `${review.name}：${({ allow: "助手已批准", ask: "需人工确认", deny: "助手已拒绝" })[review.decision]} · ${review.reason}`;
  });
  stream.addEventListener("memory_update", () => { void refreshMemory($("memory-search").value.trim()).catch((error) => notify(error.message, "error")); });
  stream.addEventListener("subagent_state", async () => {
    if (state.current?.id === sessionId) await refreshSession(sessionId, false);
  });
}

async function refreshSession(id, rerenderAll = true) {
  const fresh = await api(`/sessions/${id}`);
  if (state.current?.id !== id) return;
  state.current = fresh;
  const summary = state.sessions.find((session) => session.id === id);
  if (summary) Object.assign(summary, { title: fresh.title, status: fresh.status, updatedAt: fresh.updatedAt });
  rerenderAll ? renderCurrent() : renderSubagents();
}

async function selectSession(id) {
  try {
    state.current = await api(`/sessions/${id}`);
    renderCurrent();
    connectStream();
  } catch (error) { notify(error.message, "error"); }
}

async function deleteSession(id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session || !window.confirm(`确定删除会话“${session.title}”吗？删除后无法恢复。`)) return;
  try {
    await api(`/sessions/${id}`, { method: "DELETE" });
    state.sessions = state.sessions.filter((item) => item.id !== id);
    if (state.current?.id === id) {
      state.stream?.close();
      state.stream = null;
      state.current = null;
      if (state.sessions.length) await selectSession(state.sessions[0].id);
      else renderCurrent();
    } else renderSessions();
    notify("会话已删除");
  } catch (error) { notify(error.message, "error"); }
}

async function decide(id, decision) {
  try {
    await api(`/sessions/${state.current.id}/approvals`, { method: "POST", body: JSON.stringify({ id, decision }) });
    state.current.approvals = state.current.approvals.filter((approval) => approval.id !== id);
    renderApprovals();
  } catch (error) { notify(error.message, "error"); }
}

async function loadControlData() {
  const [capabilities, knowledge, memorySearch, graph, schedules, mcp, modelConfig] = await Promise.all([api("/capabilities"), api("/knowledge"), api("/memory?limit=30"), api("/knowledge-graph?limit=100"), api("/schedules"), api("/mcp"), api("/config/model")]);
  Object.assign(state, { capabilities, knowledge, memorySearch, graph, schedules, mcp, modelConfig });
  const runtime = await api("/config/runtime");
  $("memory-auto-learn").checked = runtime.memoryAutoLearn;
  renderRuntime(); renderKnowledge(); renderGraph(); renderSchedules(); renderMcp(); renderModelConfig();
}

function renderModelConfig() {
  const config = state.modelConfig;
  $("model-base-url").value = config.baseUrl || "";
  $("model-name").value = config.model || "";
  $("embedding-base-url").value = config.embeddingBaseUrl || "";
  $("embedding-model").value = config.embeddingModel || "";
  $("embedding-dimensions").value = config.embeddingDimensions || "";
  $("embedding-format").value = config.embeddingFormat || "auto";
  $("tool-policy").value = config.policy || "always-ask";
  $("model-api-key").value = "";
  $("model-api-key").placeholder = config.apiKeyConfigured ? "已设置，留空则保持不变" : "粘贴你的 API Key";
  $("clear-model-key-row").classList.toggle("hidden", !config.apiKeyConfigured);
  $("clear-model-key").checked = false;
  $("embedding-api-key").value = "";
  $("embedding-api-key").placeholder = config.embeddingApiKeySeparateConfigured ? "独立 Key 已设置，留空则保持不变" : config.embeddingApiKeyConfigured ? "当前复用上面的 API Key" : "粘贴独立的向量 API Key";
  $("clear-embedding-key-row").classList.toggle("hidden", !config.embeddingApiKeySeparateConfigured);
  $("clear-embedding-key").checked = false;
  $("amap-api-key").value = "";
  $("amap-api-key").placeholder = config.amapApiKeyConfigured ? "已设置，留空则保持不变" : "在高德开放平台申请的 Web 服务 Key";
  $("clear-amap-key-row").classList.toggle("hidden", !config.amapApiKeyConfigured);
  $("clear-amap-key").checked = false;
  $("bocha-api-key").value = "";
  $("bocha-api-key").placeholder = config.bochaApiKeyConfigured ? "已设置，留空则保持不变" : "在博查开放平台申请的 API Key";
  $("clear-bocha-key-row").classList.toggle("hidden", !config.bochaApiKeyConfigured);
  $("clear-bocha-key").checked = false;
  $("model-config-status").className = "config-status";
  $("model-config-status").textContent = config.apiKeyConfigured ? "API Key 已保存在本地 .env；读取配置时不会回显。" : "尚未设置 API Key。";
}

async function refreshMemory(query = "") {
  const [knowledge, memorySearch, graph] = await Promise.all([
    api("/knowledge"), api(`/memory?query=${encodeURIComponent(query)}&limit=30`), api(`/knowledge-graph?query=${encodeURIComponent(query)}&limit=100`)
  ]);
  Object.assign(state, { knowledge, memorySearch, graph });
  renderKnowledge(); renderGraph();
}

async function deleteMemory(id) {
  if (!window.confirm("确定删除这条结构化记忆吗？")) return;
  try { await api(`/memory/facts/${id}`, { method: "DELETE" }); await refreshMemory($("memory-search").value.trim()); notify("记忆已删除"); }
  catch (error) { notify(error.message, "error"); }
}

async function deleteSchedule(id) {
  try {
    await api(`/schedules/${id}`, { method: "DELETE" });
    state.schedules = state.schedules.filter((schedule) => schedule.id !== id);
    renderSchedules(); notify("定时任务已删除");
  } catch (error) { notify(error.message, "error"); }
}

function setInspector(open) {
  $("inspector").classList.toggle("open", open);
  $("inspector-backdrop").classList.toggle("show", open);
}

document.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item === tab));
  document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab.dataset.tab));
}));

$("new-session").addEventListener("click", async () => {
  try {
    const session = await api("/sessions", { method: "POST", body: "{}" });
    state.sessions.unshift(session);
    await selectSession(session.id);
  } catch (error) { notify(error.message, "error"); }
});

async function saveRuntimeSetting(input) {
  try {
    const saved = await api("/config/runtime", { method: "PUT", body: JSON.stringify(input) });
    state.capabilities.policy = saved.policy;
    state.modelConfig.policy = saved.policy;
    $("tool-policy").value = saved.policy;
    $("memory-auto-learn").checked = saved.memoryAutoLearn;
    renderRuntime();
    notify("设置已保存并立即生效");
  } catch (error) {
    const runtime = await api("/config/runtime");
    $("approval-mode").value = runtime.policy;
    $("memory-auto-learn").checked = runtime.memoryAutoLearn;
    notify(error.message, "error");
  }
}
$("approval-mode").addEventListener("change", () => { void saveRuntimeSetting({ policy: $("approval-mode").value }); });
$("memory-auto-learn").addEventListener("change", () => { void saveRuntimeSetting({ memoryAutoLearn: $("memory-auto-learn").checked }); });

$("composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("input");
  const value = input.value.trim();
  if (!value || !state.current) return;
  try {
    await api(`/sessions/${state.current.id}/tasks`, { method: "POST", body: JSON.stringify({ text: value }) });
    input.value = "";
  } catch (error) { notify(error.message, "error"); }
});

$("stop").addEventListener("click", async () => {
  if (!state.current) return;
  try { await api(`/sessions/${state.current.id}/stop`, { method: "POST", body: "{}" }); }
  catch (error) { notify(error.message, "error"); }
});

$("save-memory").addEventListener("click", async () => {
  try {
    await api("/knowledge/memory", { method: "PUT", body: JSON.stringify({ content: $("memory-editor").value }) });
    state.knowledge.memory = $("memory-editor").value;
    notify("长期记忆已保存");
  } catch (error) { notify(error.message, "error"); }
});

$("memory-search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await refreshMemory($("memory-search").value.trim()); }
  catch (error) { notify(error.message, "error"); }
});

$("memory-fact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/memory/facts", { method: "POST", body: JSON.stringify({ content: $("memory-fact-content").value, kind: $("memory-fact-kind").value, subject: "user", predicate: "states" }) });
    event.target.reset(); await refreshMemory(); notify("结构化记忆已保存");
  } catch (error) { notify(error.message, "error"); }
});

$("graph-search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { state.graph = await api(`/knowledge-graph?query=${encodeURIComponent($("graph-search").value.trim())}&limit=100`); renderGraph(); }
  catch (error) { notify(error.message, "error"); }
});

$("schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const schedule = await api("/schedules", { method: "POST", body: JSON.stringify({
      name: $("schedule-name").value,
      prompt: $("schedule-prompt").value,
      intervalMinutes: Number($("schedule-interval").value),
      sessionId: $("schedule-current").checked ? state.current?.id : null
    }) });
    state.schedules.unshift(schedule); renderSchedules(); event.target.reset(); $("schedule-interval").value = "60"; $("schedule-current").checked = true; notify("定时任务已创建");
  } catch (error) { notify(error.message, "error"); }
});

$("refresh-mcp").addEventListener("click", async () => {
  try { state.mcp = await api("/mcp/refresh", { method: "POST", body: "{}" }); renderMcp(); notify("MCP 状态已刷新"); }
  catch (error) { notify(error.message, "error"); }
});

$("model-api-key").addEventListener("input", () => {
  if ($("model-api-key").value) $("clear-model-key").checked = false;
});

$("embedding-api-key").addEventListener("input", () => {
  if ($("embedding-api-key").value) $("clear-embedding-key").checked = false;
});

$("amap-api-key").addEventListener("input", () => {
  if ($("amap-api-key").value) $("clear-amap-key").checked = false;
});

$("model-config-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("model-config-status");
  status.className = "config-status";
  status.textContent = "正在保存…";
  try {
    const modelConfig = await api("/config/model", { method: "PUT", body: JSON.stringify({
      baseUrl: $("model-base-url").value,
      model: $("model-name").value,
      embeddingBaseUrl: $("embedding-base-url").value,
      embeddingModel: $("embedding-model").value,
      embeddingDimensions: $("embedding-dimensions").value,
      embeddingFormat: $("embedding-format").value,
      embeddingApiKey: $("embedding-api-key").value,
      clearEmbeddingApiKey: $("clear-embedding-key").checked,
      amapApiKey: $("amap-api-key").value,
      clearAmapApiKey: $("clear-amap-key").checked,
      bochaApiKey: $("bocha-api-key").value,
      clearBochaApiKey: $("clear-bocha-key").checked,
      policy: $("tool-policy").value,
      apiKey: $("model-api-key").value,
      clearApiKey: $("clear-model-key").checked
    }) });
    state.modelConfig = modelConfig;
    [state.capabilities, state.mcp] = await Promise.all([api("/capabilities"), api("/mcp")]);
    renderModelConfig(); renderRuntime(); renderMcp();
    status.className = "config-status success";
    status.textContent = "配置已保存到本地 .env，并已应用。";
    notify("模型配置已保存");
  } catch (error) {
    status.className = "config-status error";
    status.textContent = error.message;
  }
});

$("toggle-inspector").addEventListener("click", () => setInspector(true));
$("close-inspector").addEventListener("click", () => setInspector(false));
$("inspector-backdrop").addEventListener("click", () => setInspector(false));
$("input").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("composer").requestSubmit(); } });

try {
  [state.sessions] = await Promise.all([api("/sessions"), loadControlData()]);
  if (state.sessions.length) await selectSession(state.sessions[0].id);
  else {
    const session = await api("/sessions", { method: "POST", body: "{}" });
    state.sessions = [session];
    await selectSession(session.id);
  }
} catch (error) {
  notify(error.message, "error");
}
