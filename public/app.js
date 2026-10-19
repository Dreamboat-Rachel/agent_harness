import { renderMarkdown } from "./markdown.js";
import { icon, starters, panelNames, statusLabel, orbit } from "./workbench-ui.js";

const state = {
  projects: [], projectId: localStorage.getItem("agent-harness-project") || "default", switchingProject: false, sessions: [], current: null, stream: null, capabilities: null, view: "home", page: null, submitting: false, focusUserMessage: null, mcpEditing: null, mcpBusy: false, skillBusy: false, toolTab: "mcp", modelEditing: null, modelSettingsTab: "models",
  expandedToolResults: new Set(), toolResultHeights: new Map(),
  knowledge: { memory: "", skills: [], stats: {} }, memorySearch: { facts: [], graph: { entities: [], relations: [] } },
  graph: { entities: [], relations: [] }, schedules: [], mcp: [], skills: { installed: [], catalog: [] },
  models: { defaultModelId: null, models: [] }, selectedModelId: "", pendingSources: [],
  modelConfig: { baseUrl: "", model: "", embeddingBaseUrl: "", embeddingModel: "", embeddingDimensions: "", embeddingFormat: "auto", policy: "always-ask", apiKeyConfigured: false, embeddingApiKeyConfigured: false, embeddingApiKeySeparateConfigured: false, amapApiKeyConfigured: false }
};
let pendingProjectImport = null;

const $ = (id) => document.getElementById(id);
function confirmInApp(message, { title = "确认操作", confirmText = "确认删除" } = {}) {
  const dialog = $("app-confirm-dialog");
  $("app-confirm-title").textContent = title;
  $("app-confirm-message").textContent = message;
  $("app-confirm-accept").textContent = confirmText;
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    dialog.showModal();
    $("app-confirm-cancel").focus();
  });
}

const workspacePages = {
  memory: { icon: "memory", description: "管理长期记忆与偏好，让每次协作都能接着上次的理解。" },
  schedules: { icon: "clock", description: "填写名称、任务和运行间隔（分钟；60 表示每小时）。勾选“使用当前会话”可沿用当前对话，取消后会单独创建任务。首次运行在设定间隔后开始，需保持应用运行。" },
  graph: { icon: "graph", description: "查看信息之间的联系，管理自动学习和知识关系。" },
  mcp: { icon: "tools", description: "连接 MCP 服务，安装 Skills，为你的 AI 工作伙伴扩展能力。" },
  config: { icon: "settings", description: "管理模型连接、检索能力和操作偏好。" },
};

const smoothSelects = new Map();

function closeSmoothSelect(select, restoreFocus = false) {
  const control = smoothSelects.get(select);
  if (!control?.root.classList.contains("open")) return;
  control.root.classList.remove("open");
  control.trigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) control.trigger.focus();
}

function syncSmoothSelect(select) {
  const control = smoothSelects.get(select);
  if (!control) return;
  const selected = select.selectedOptions[0] || [...select.options].find((option) => !option.hidden);
  control.value.textContent = selected?.textContent || "请选择";
  control.trigger.disabled = select.disabled;
  control.options.forEach(({ option, button }) => {
    const active = option === selected;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
}

function positionSmoothSelect(select) {
  const control = smoothSelects.get(select);
  if (!control || !control.root.classList.contains("open")) return;
  const rect = control.trigger.getBoundingClientRect();
  const menuHeight = Math.min(control.options.length * 42 + 12, window.innerHeight * 0.45, 248);
  const dropUp = window.innerHeight - rect.bottom < menuHeight + 12 && rect.top > menuHeight + 12;
  control.root.classList.toggle("drop-up", dropUp);
  control.menu.style.maxHeight = `${menuHeight}px`;
  control.menu.style.top = `${dropUp ? Math.max(8, rect.top - menuHeight - 6) : Math.min(window.innerHeight - menuHeight - 8, rect.bottom + 6)}px`;
  control.menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`;
  control.menu.style.width = `${rect.width}px`;
}

function openSmoothSelect(select) {
  const control = smoothSelects.get(select);
  if (!control || control.trigger.disabled) return;
  smoothSelects.forEach((_, otherSelect) => { if (otherSelect !== select) closeSmoothSelect(otherSelect); });
  control.root.classList.add("open");
  control.trigger.setAttribute("aria-expanded", "true");
  positionSmoothSelect(select);
}

function setupSmoothSelect(select) {
  if (smoothSelects.has(select)) return;
  const visibleOptions = [...select.options].filter((option) => !option.hidden);
  const root = document.createElement("div");
  root.className = "smooth-select";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "smooth-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", select.closest("label")?.childNodes[0]?.textContent?.trim() || "选择选项");
  trigger.innerHTML = '<span class="smooth-select-value"></span><span class="smooth-select-chevron" aria-hidden="true"></span>';
  const menu = document.createElement("div");
  menu.className = "smooth-select-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "选择选项");
  const options = visibleOptions.map((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "smooth-select-option";
    button.setAttribute("role", "option");
    button.innerHTML = `<span>${escapeHtml(option.textContent)}</span><span class="smooth-select-check" aria-hidden="true">✓</span>`;
    button.disabled = option.disabled;
    button.addEventListener("click", () => {
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      syncSmoothSelect(select);
      closeSmoothSelect(select, true);
    });
    menu.append(button);
    return { option, button };
  });
  select.classList.add("native-select-proxy");
  select.setAttribute("aria-hidden", "true");
  select.tabIndex = -1;
  select.insertAdjacentElement("afterend", root);
  root.append(trigger, menu);
  const control = { root, trigger, menu, value: trigger.querySelector(".smooth-select-value"), options };
  smoothSelects.set(select, control);

  trigger.addEventListener("click", () => root.classList.contains("open") ? closeSmoothSelect(select) : openSmoothSelect(select));
  trigger.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") return closeSmoothSelect(select);
    openSmoothSelect(select);
    const enabled = options.filter(({ button }) => !button.disabled);
    const selectedIndex = Math.max(0, enabled.findIndex(({ option }) => option.value === select.value));
    const index = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : event.key === "ArrowUp" ? Math.max(0, selectedIndex - 1) : Math.min(enabled.length - 1, selectedIndex + 1);
    enabled[index]?.button.focus();
  });
  menu.addEventListener("keydown", (event) => {
    const enabled = options.filter(({ button }) => !button.disabled);
    const index = enabled.findIndex(({ button }) => button === document.activeElement);
    if (event.key === "Escape") { event.preventDefault(); closeSmoothSelect(select, true); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? Math.min(enabled.length - 1, index + 1) : Math.max(0, index - 1);
      enabled[next]?.button.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      enabled[event.key === "Home" ? 0 : enabled.length - 1]?.button.focus();
    }
  });
  select.addEventListener("change", () => syncSmoothSelect(select));
  syncSmoothSelect(select);
}

function setupSmoothSelects() {
  document.querySelectorAll(".compact-form select").forEach(setupSmoothSelect);
  document.addEventListener("pointerdown", (event) => {
    smoothSelects.forEach((control, select) => { if (!control.root.contains(event.target)) closeSmoothSelect(select); });
  });
  window.addEventListener("resize", () => smoothSelects.forEach((_, select) => positionSmoothSelect(select)));
  document.addEventListener("scroll", (event) => smoothSelects.forEach((control, select) => {
    if (!control.root.classList.contains("open")) return;
    if (control.menu.contains(event.target)) return;
    const rect = control.trigger.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) closeSmoothSelect(select);
    else positionSmoothSelect(select);
  }), true);
  document.addEventListener("reset", () => requestAnimationFrame(() => smoothSelects.forEach((_, select) => syncSmoothSelect(select))));
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "content-type": "application/json", "x-project-id": state.projectId || "default", ...(options.headers || {}) }
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
  const list = $("sessions");
  if (!list) return;
  const projectSessions = list.closest(".project-session-list");
  if (projectSessions) projectSessions.hidden = state.sessions.length === 0;
  list.innerHTML = state.sessions.length
    ? state.sessions.map((session) => `<div class="session-row ${!state.page && state.view === "task" && session.id === state.current?.id ? "active" : ""}"><button type="button" class="session-item" data-session-id="${escapeHtml(session.id)}"><span>${escapeHtml(session.title === "New Session" ? "未命名任务" : session.title)}</span><small><i class="state-dot ${escapeHtml(session.status)}"></i>${escapeHtml(statusLabel(session.status))} · ${formatTime(session.updatedAt)}</small></button><button type="button" class="session-delete" title="删除任务" aria-label="删除任务：${escapeHtml(session.title)}" data-delete-session="${escapeHtml(session.id)}">×</button></div>`).join("")
    : "";
  document.querySelectorAll("[data-session-id]").forEach((element) => element.addEventListener("click", () => selectSession(element.dataset.sessionId)));
  document.querySelectorAll("[data-delete-session]").forEach((button) => button.addEventListener("click", () => deleteSession(button.dataset.deleteSession)));
}

function renderProjects() {
  const current = state.projects.find((project) => project.id === state.projectId);
  $("project-list").innerHTML = state.projects.map((project) => {
    const selected = project.id === current?.id;
    const displayName = project.isDefault && project.name === "项目" ? "默认工作区" : project.name;
    return `<div class="project-row ${selected ? "selected" : ""}"><button class="project-option ${selected ? "selected" : ""}" type="button" aria-pressed="${selected}" data-project-id="${escapeHtml(project.id)}"><span data-icon="folder"></span><span class="project-option-copy" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span></button><span class="project-option-meta"><button class="project-option-chat" type="button" data-new-project-chat="${escapeHtml(project.id)}" title="在 ${escapeHtml(displayName)} 下新建对话" aria-label="在 ${escapeHtml(displayName)} 下新建对话"><span data-icon="edit"></span></button></span>${selected ? `<div class="project-session-list" ${state.sessions.length ? "" : "hidden"}><div id="sessions" class="sessions" aria-label="${escapeHtml(displayName)} 项目对话"></div></div>` : ""}</div>`;
  }).join("");
  $("project-list").querySelectorAll("[data-icon]").forEach((element) => { element.innerHTML = icon(element.dataset.icon); });
  $("create-project").disabled = state.switchingProject;
  renderSessions();
}

function modelStorageKey(projectId = state.projectId) {
  return projectId === "default" ? "agent-harness-model" : `agent-harness-model-${projectId}`;
}

async function switchProject(projectId) {
  if (!projectId || state.switchingProject) return false;
  if (projectId === state.projectId) return true;
  state.switchingProject = true;
  renderProjects();
  state.stream?.close();
  state.stream = null;
  state.projectId = projectId;
  localStorage.setItem("agent-harness-project", projectId);
  state.selectedModelId = localStorage.getItem(modelStorageKey(projectId)) || "";
  state.current = null;
  state.sessions = [];
  state.page = null;
  state.view = "home";
  state.pendingSources = [];
  state.submitting = false;
  $("input").value = "";
  renderProjects();
  setInspector(false);
  renderCurrent();
  try {
    [state.sessions] = await Promise.all([api("/sessions"), loadControlData()]);
    if (state.sessions.length) await selectSession(state.sessions[0].id, true);
    else renderCurrent();
    renderSessions();
    return true;
  } catch (error) { notify(error.message, "error"); return false; }
  finally { state.switchingProject = false; renderProjects(); }
}

const ignoredProjectDirectories = new Set([".git", ".hg", ".svn", "node_modules", "dist", "build", "coverage", ".next", ".turbo", ".cache", ".venv", "venv", "target", "release", "releases", "tmp", "temp"]);
const ignoredProjectFileExtensions = new Set([".zip", ".7z", ".rar", ".tar", ".gz", ".exe", ".msi", ".dmg", ".appimage", ".asar"]);
const projectUploadChunkBytes = 4 * 1024 * 1024;
const maxBrowserProjectBytes = 2 * 1024 * 1024 * 1024;

function projectFileIsIgnored(relativePath) {
  const parts = relativePath.split("/");
  const filename = parts.at(-1).toLocaleLowerCase();
  const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  return parts.some((part) => {
    const name = part.toLocaleLowerCase();
    return ignoredProjectDirectories.has(name) || /^desktop-dist(?:[-_.].*)?$/.test(name);
  }) || ignoredProjectFileExtensions.has(extension);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 1024 * 1024 * 100 ? 0 : 1)} MB`;
}

function prepareProjectImport(fileList, linkedFolder = null) {
  const files = [...fileList].map((item) => {
    if (item?.file) return item;
    const pathParts = item.webkitRelativePath?.split("/") || [];
    return { file: item, rootName: pathParts[0], relativePath: pathParts.length ? pathParts.slice(1).join("/") : item.name };
  });
  if (!linkedFolder && !files.length) throw new Error("所选文件夹为空，或浏览器未能读取其中的文件");
  const rootName = linkedFolder?.name || files[0].rootName || (files[0].relativePath.includes("/") ? files[0].relativePath.split("/")[0] : files[0].file.name);
  const included = files.filter(({ relativePath }) => relativePath && !projectFileIsIgnored(relativePath));
  if (!linkedFolder && !included.length) throw new Error("所选文件夹中没有可导入的文件");
  if (included.length > 20_000) throw new Error("项目文件数量超过 20000 个，请先排除依赖或生成目录");
  const totalBytes = included.reduce((sum, item) => sum + item.file.size, 0);
  if (!linkedFolder && totalBytes > maxBrowserProjectBytes) throw new Error("浏览器导入的项目不能超过 2 GB；请排除大型数据和构建产物后重试");

  let projectName = rootName;
  const existingNames = new Set(state.projects.map((project) => project.name.toLocaleLowerCase()));
  for (let suffix = 2; existingNames.has(projectName.toLocaleLowerCase()); suffix += 1) projectName = `${rootName} (${suffix})`;
  pendingProjectImport = { files: included, name: projectName, workspacePath: linkedFolder?.workspacePath || "", totalBytes, excludedCount: files.length - included.length };
  $("project-import-name").value = projectName;
  $("project-import-summary").textContent = linkedFolder
    ? `确认后将链接本机文件夹“${rootName}”，不复制其中的文件。`
    : `将导入 ${included.length} 个文件（${formatBytes(totalBytes)}）${files.length > included.length ? `，已排除 ${files.length - included.length} 个缓存、依赖或打包文件` : ""}。`;
  $("project-import-status").textContent = "";
  $("project-import-confirm").disabled = false;
  $("project-import-dialog").showModal();
  $("project-import-name").focus();
}

async function importBrowserProject(files, projectName, totalBytes) {
  notify(`正在导入 ${files.length} 个项目文件…`);
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { document.querySelector("#toast").className = "toast"; }, 60_000);
  let result;
  try {
    result = await api("/projects", { method: "POST", body: JSON.stringify({ name: projectName }) });
    const projectId = result.project.id;
    state.projects = result.projects || state.projects;
    renderProjects();
    let uploadedBytes = 0;
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const { file, relativePath } = files[fileIndex];
      let offset = 0;
      do {
        const end = Math.min(file.size, offset + projectUploadChunkBytes);
        const chunk = file.slice(offset, end);
        const response = await fetch(`/api/projects/files?path=${encodeURIComponent(relativePath)}&offset=${offset}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream", "x-project-id": projectId },
          body: chunk
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `上传文件失败：${relativePath}`);
        offset = end;
        uploadedBytes += chunk.size;
        if (fileIndex % 20 === 0 || fileIndex === files.length - 1) {
          const percent = totalBytes ? Math.floor(uploadedBytes / totalBytes * 100) : 100;
          notify(`正在导入项目 ${percent}% · ${fileIndex + 1}/${files.length} 个文件`);
          clearTimeout(notify.timer);
          notify.timer = setTimeout(() => { document.querySelector("#toast").className = "toast"; }, 60_000);
        }
      } while (offset < file.size);
    }
    result.importedFiles = files.length;
  } catch (error) {
    const refreshed = await api("/projects").catch(() => null);
    if (refreshed) {
      state.projects = refreshed.projects || state.projects;
      renderProjects();
      const partialProject = state.projects.find((project) => project.id === result?.project?.id || project.name === projectName);
      if (partialProject) {
        await switchProject(partialProject.id);
        throw new Error(`${error.message}；项目已创建，已完成的文件保留在项目中`);
      }
    }
    throw error;
  }
  state.projects = result.projects || state.projects;
  renderProjects();
  return result;
}

async function selectProjectFolder() {
  if (state.switchingProject) return;
  const desktop = window.agentHarnessDesktop;
  if (desktop?.selectProjectFolder) {
    try {
      const result = await desktop.selectProjectFolder();
      if (result?.cancelled) return;
      prepareProjectImport([], result);
    } catch (error) { notify(error.message, "error"); }
    return;
  }
  $("project-desktop-required-dialog").showModal();
}

function renderHome() {
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";
  const date = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  const recent = state.sessions.slice(0, 3);
  const connectedTools = state.mcp.filter((server) => !server.error).reduce((sum, server) => sum + (Number(server.tools) || 0), 0);
  $("messages").innerHTML = `<div class="dashboard">
    <div class="dashboard-greeting"><span>${greeting}，今天想创造些什么？</span><time>${date}</time></div>
    <section class="hero"><div class="hero-copy"><div class="eyebrow"><span></span> YOUR IDEAS, IN MOTION</div><h1>让想法，<br>开始<span class="hero-emphasis">发生。</span></h1><p>一个懂你、记得你，也能为你行动的 AI 工作伙伴。<br>把复杂留给 Agent，把专注留给自己。</p><button class="hero-link" type="button" data-focus-composer>开启今天的第一个灵感 ${icon("right")}</button></div><div class="hero-visual">${orbit}<span class="orbit-caption">THINK · CONNECT · CREATE</span></div></section>
    <div class="section-heading"><h2>从这里，开始更轻松</h2><span>选择一个方向，或直接描述你的任务</span></div>
    <div class="starter-grid">${starters.map((starter, index) => `<button class="starter-card" type="button" data-starter="${index}"><span class="starter-icon ${starter.color}">${icon(starter.icon)}</span><span class="starter-arrow">${icon("right")}</span><strong>${starter.title}</strong><small>${starter.description}</small></button>`).join("")}</div>
    <div class="dashboard-lower"><section class="recent-section"><div class="section-heading"><h2>接着上次的想法</h2><button class="text-button" type="button" data-open-search>查看全部 ${icon("right")}</button></div><div class="recent-list">${recent.length ? recent.map((session) => `<button class="recent-item" type="button" data-recent-session="${escapeHtml(session.id)}"><span class="recent-icon">${icon("document")}</span><span class="recent-copy"><strong>${escapeHtml(session.title === "New Session" ? "未命名任务" : session.title)}</strong><small>${formatTime(session.updatedAt)}</small></span><span class="recent-status"><i class="state-dot ${escapeHtml(session.status)}"></i>${escapeHtml(statusLabel(session.status))}</span>${icon("chevron")}</button>`).join("") : `<div class="recent-empty">${icon("folder")}<div><strong>这里会留下你的每一次探索</strong><p>发送第一个任务，下次可以从这里继续。</p></div></div>`}</div></section>
    <section class="workspace-summary"><div class="summary-heading"><span class="summary-spark">${icon("spark")}</span><h2>越协作，越默契</h2></div><p>记住重要的事，连接需要的能力。</p><div class="summary-metrics"><button type="button" data-open-panel="memory"><strong>${Number(state.knowledge.stats?.facts) || 0}<span>条</span></strong><small>记忆片段 ${icon("chevron")}</small></button><button type="button" data-open-panel="mcp"><strong>${connectedTools}<span>个</span></strong><small>连接工具 ${icon("chevron")}</small></button><button type="button" data-open-panel="schedules"><strong>${state.schedules.length}<span>项</span></strong><small>自动任务 ${icon("chevron")}</small></button></div></section></div>
  </div>`;
}

function renderMessages() {
  const container = $("messages");
  const messages = state.current?.messages || [];
  const home = state.view === "home" || (!messages.length && !state.submitting);
  document.querySelector(".conversation").classList.toggle("is-home", home);
  if (state.page) return;
  const followOutput = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  if (home) { renderHome(); return; }
  container.innerHTML = messages.map((message, index) => {
    if (message.role === "tool") {
      const key = String(message.id || message.toolCallId || index);
      const expanded = state.expandedToolResults.has(key);
      const height = state.toolResultHeights.get(key);
      const status = message.status === "error" ? "执行失败" : message.status === "completed" ? "执行完成" : "工具调用";
      return `<article class="message tool"><div class="avatar">${icon("tools")}</div><div class="message-body tool-result ${expanded ? "expanded" : ""}"><button class="tool-result-toggle" type="button" data-tool-result-key="${escapeHtml(key)}" aria-expanded="${expanded}"><span class="tool-result-heading"><span>${escapeHtml(status)}</span>${message.toolName ? `<code>${escapeHtml(message.toolName)}</code>` : ""}</span><span class="tool-result-action">${expanded ? "收起" : "展开"}${icon("chevron")}</span></button><div class="tool-result-content plain-content" ${height ? `style="height:${height}px"` : ""}>${escapeHtml(message.content)}</div></div></article>`;
    }
    const modelMismatch = message.requestedModel && message.returnedModel && message.requestedModel !== message.returnedModel;
    const modelMeta = message.role === "assistant" && message.requestedModel ? `<span class="message-model-meta ${modelMismatch ? "mismatch" : ""}">请求模型：${escapeHtml(message.requestedModel)} · 上游返回：${escapeHtml(message.returnedModel || "未提供标识")}</span>` : "";
    const meta = message.role === "user" ? "" : `<div class="message-meta">${escapeHtml(({ assistant: "Agent Harness", system: "系统提示" })[message.role] || message.role)}${modelMeta}</div>`;
    const attachments = message.role === "user" && message.attachments?.length ? `<div class="message-attachments">${message.attachments.map((name) => `<span>${icon("document")}${escapeHtml(name)}</span>`).join("")}</div>` : "";
    return `<article class="message ${escapeHtml(message.role)}"><div class="avatar">${message.role === "user" ? "你" : message.role === "system" ? "!" : icon("spark")}</div><div class="message-body">${meta}<div class="message-content ${message.role === "assistant" ? "markdown-content" : "plain-content"}">${message.role === "assistant" ? renderMarkdown(message.content) : escapeHtml(message.content)}</div>${attachments}</div></article>`;
  }).join("") || '<div class="task-starting">正在开启你的任务…</div>';
  let focusedLatestUserMessage = false;
  if (state.focusUserMessage?.sessionId === state.current?.id) {
    const userMessages = container.querySelectorAll(".message.user");
    const latestUserMessage = userMessages[userMessages.length - 1];
    if (latestUserMessage && userMessages.length > state.focusUserMessage.afterCount) {
      const topPadding = Number.parseFloat(getComputedStyle(container).paddingTop) || 0;
      const messageOffset = latestUserMessage.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTo({ top: container.scrollTop + messageOffset - topPadding, behavior: "smooth" });
      state.focusUserMessage = null;
      focusedLatestUserMessage = true;
    }
  }
  if (followOutput && !focusedLatestUserMessage) container.scrollTop = container.scrollHeight;
  renderTaskProgress();
}

function renderCurrent() {
  document.querySelector(".conversation").classList.toggle("is-settings", Boolean(state.page));
  $("workspace-page").classList.toggle("hidden", !state.page);
  $("workspace-page").dataset.page = state.page || "";
  $("session-title").textContent = state.page ? panelNames[state.page] : state.view === "home" ? "工作台" : (state.current?.title === "New Session" ? "新任务" : state.current?.title) || "新任务";
  const status = state.current?.status || "idle";
  $("status").textContent = statusLabel(status);
  $("status").className = `status ${status}`;
  $("stop").disabled = state.view === "home" || status !== "running";
  $("stop").classList.toggle("hidden", state.view === "home" || status !== "running");
  $("input").disabled = state.submitting || (state.view === "task" && status === "running");
  $("composer-model").disabled = $("input").disabled || !state.models.models.some((entry) => entry.enabled);
  $("composer-model-trigger").disabled = $("composer-model").disabled;
  $("add-source").disabled = $("input").disabled;
  updateComposer();
  $("input").placeholder = state.view === "task" && status === "running" ? "Agent 正在执行任务，你可以随时停止…" : "说说你想完成的事，剩下的交给我…";
  renderSessions();
  renderMessages();
  renderApprovals();
  renderSubagents();
  renderTaskProgress();
  updateNavigation();
}

function renderTaskProgress() {
  const session = state.current;
  const visible = state.view === "task" && (session?.messages?.length || state.submitting);
  $("task-progress").classList.toggle("hidden", !visible);
  if (!visible) return;
  const pending = session?.approvals?.length || 0;
  const running = session?.status === "running" || state.submitting;
  const toolCount = session?.messages?.filter((message) => message.role === "tool").length || 0;
  const assistantMessages = session?.messages?.filter((message) => message.role === "assistant") || [];
  const hasOutput = assistantMessages.some((message) => message.content?.trim());
  const outcome = !running ? (session?.status === "error" ? "出现错误" : hasOutput ? "结果已返回" : "任务已结束") : pending ? "等待你的确认" : toolCount ? "执行与整理中" : "正在思考";
  $("task-progress").innerHTML = `<span class="progress-stage done">${icon("check")} 已接收</span><span class="progress-connector"></span><span class="progress-stage ${running ? "current" : "done"}">${icon(pending ? "shield" : running ? "spark" : "check")}${outcome}</span><span class="progress-detail">${toolCount} 次工具调用</span><button type="button" class="progress-action ${pending ? "needs-approval" : ""}" data-open-panel="runtime">${pending ? `${pending} 项待确认` : "查看详情"}${icon("chevron")}</button>`;
}

function renderRuntime() {
  const info = state.capabilities;
  if (!info) return;
  $("approval-mode").value = info.policy;
  syncSmoothSelect($("approval-mode"));
  const selectedModel = state.models.models.find((entry) => entry.id === state.selectedModelId && entry.enabled) || state.models.models.find((entry) => entry.id === state.models.defaultModelId && entry.enabled);
  $("composer-policy").textContent = ({ "always-ask": "操作前确认", "assistant-approve": "智能审批", "allow-all": "自动通过", "workspace-write": "工作区写入", "read-only": "只读模式", "deny-all": "拒绝工具操作" })[info.policy] || "操作策略";
  $("runtime-stats").innerHTML = [
    ["模型", selectedModel?.name || (info.modelConfigured ? "已连接" : "体验模式")],
    ["记忆检索", info.memory?.mode === "vector" ? `向量 · ${info.memory.model}${info.memory.format ? ` · ${info.memory.format}` : ""}` : info.memory?.mode === "degraded" ? "向量异常，已降级" : "词法降级"],
    ["命令沙箱", info.sandbox?.available ? `${info.sandbox.backend} · ${info.sandbox.network === "none" ? "禁网" : "联网"}` : "不可用 · 命令拒绝执行"],
    ["工具策略", $("composer-policy").textContent],
    ["数据保存", "本地数据库"],
    ["工作区", info.workspace]
  ].map(([label, value]) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  const featureNames = { "context-compaction": "长对话整理", "langgraph-memory": "长期记忆", "vector-memory": "语义检索", "knowledge-graph": "知识图谱", "bubblewrap-sandbox": "隔离执行", skills: "技能", subagents: "多 Agent 协作", scheduler: "定时任务", "mcp-http": "工具连接", "amap-maps-mcp": "地图工具", "bocha-web-search": "联网搜索" };
  $("features").innerHTML = info.features.map((feature) => `<span class="tag">${escapeHtml(featureNames[feature] || feature)}</span>`).join("");
}

function updateComposer() {
  const input = $("input");
  input.style.height = "auto";
  input.style.height = `${Math.min(Math.max(input.scrollHeight, 36), 180)}px`;
  document.querySelector(".send-button").disabled = input.disabled || state.submitting || (!input.value.trim() && !state.pendingSources.length);
}

function renderApprovals() {
  const approvals = state.current?.approvals || [];
  $("approvals").innerHTML = approvals.length
    ? approvals.map((approval) => `<div class="list-item approval"><div class="item-head"><strong>${escapeHtml(approval.name)}</strong><span class="warn-dot"></span></div><code>${escapeHtml(JSON.stringify(approval.arguments, null, 2))}</code>${approval.reviewReason ? `<p class="hint">${escapeHtml(approval.reviewReason)}</p>` : ""}<div class="approval-actions"><button class="allow" type="button" data-approval="${escapeHtml(approval.id)}" data-decision="allow">允许</button><button class="deny" type="button" data-approval="${escapeHtml(approval.id)}" data-decision="deny">拒绝</button></div></div>`).join("")
    : '<div class="panel-empty">暂无待审批操作</div>';
  document.querySelectorAll("[data-approval]").forEach((button) => button.addEventListener("click", () => decide(button.dataset.approval, button.dataset.decision)));
  renderTaskProgress();
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
  if (document.querySelector(".conversation").classList.contains("is-home")) renderHome();
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
    if (!await confirmInApp("确定删除这条图谱关系吗？此操作无法撤销。")) return;
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
  $("schedule-count").textContent = state.schedules.length;
  $("schedules").innerHTML = state.schedules.length
    ? state.schedules.map((schedule) => `<div class="list-item"><div class="item-head"><strong>${escapeHtml(schedule.name)}</strong><button class="delete-button" type="button" title="删除定时任务" aria-label="删除定时任务" data-delete-schedule="${escapeHtml(schedule.id)}">×</button></div><p>${escapeHtml(schedule.prompt)}</p><small>每 ${schedule.intervalMinutes} 分钟 · 下次 ${formatTime(schedule.nextRunAt)}</small></div>`).join("")
    : '<div class="panel-empty">暂无定时任务</div>';
  document.querySelectorAll("[data-delete-schedule]").forEach((button) => button.addEventListener("click", () => deleteSchedule(button.dataset.deleteSchedule)));
  if (document.querySelector(".conversation").classList.contains("is-home")) renderHome();
}

function renderMcp() {
  $("mcp-servers").innerHTML = state.mcp.length
    ? state.mcp.map((server) => `<article class="list-item mcp-card"><div class="item-head"><strong>${icon("tools")}${escapeHtml(server.name)}</strong><span class="connection-state ${server.enabled === false ? "disabled" : server.connected ? "connected" : "failed"}">${server.enabled === false ? "已停用" : server.connected ? "已连接" : "连接失败"}</span></div><p class="mcp-endpoint">${escapeHtml(server.url)}</p><small>${server.enabled === false ? "启用后可供任务调用" : server.error ? escapeHtml(server.error) : `${server.tools} 个工具可供调用`}</small><div class="mcp-card-actions"><button type="button" class="text-button" data-edit-mcp="${escapeHtml(server.name)}">编辑配置</button><button type="button" class="text-button" data-toggle-mcp="${escapeHtml(server.name)}">${server.enabled === false ? "启用" : "停用"}</button><button type="button" class="text-button danger-text" data-delete-mcp="${escapeHtml(server.name)}">删除</button></div></article>`).join("")
    : '<div class="panel-empty">还没有连接工具。点击“添加 MCP 服务”，填写地址即可开始。</div>';
  syncMcpBusy();
  if (document.querySelector(".conversation").classList.contains("is-home")) renderHome();
}

function renderSkills() {
  const installed = state.skills.installed || [];
  const query = ($("skill-search")?.value || "").trim().toLocaleLowerCase();
  const catalog = (state.skills.catalog || []).filter((skill) => !query || [skill.title, skill.name, skill.description, skill.category, skill.publisher].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
  $("skill-installed-count").textContent = `${installed.filter((skill) => skill.enabled).length} 个可用`;
  $("installed-skills").innerHTML = installed.length
    ? installed.map((skill) => {
      const builtIn = skill.name === "workspace-basics";
      const source = builtIn ? "内置基础能力" : skill.source?.label || "本机导入";
      const description = skill.description || "这个 Skill 没有填写说明";
      return `<article class="list-item skill-card" title="${escapeHtml(description)}"><div class="skill-card-top"><span class="skill-icon">${icon("spark")}</span><div><strong>${escapeHtml(skill.title || skill.name)}</strong><small>${escapeHtml(skill.name)}</small></div><span class="connection-state ${skill.enabled ? "connected" : "disabled"}">${skill.enabled ? "已启用" : "已停用"}</span></div><p>${escapeHtml(description)}</p><div class="skill-source">${escapeHtml(source)}</div><div class="mcp-card-actions"><button class="text-button" type="button" data-view-skill="${escapeHtml(skill.name)}">查看内容</button><button class="text-button" type="button" data-toggle-skill="${escapeHtml(skill.name)}">${skill.enabled ? "停用" : "启用"}</button>${builtIn ? "" : `<button class="text-button danger-text" type="button" data-delete-skill="${escapeHtml(skill.name)}">卸载</button>`}</div></article>`;
    }).join("")
    : '<div class="panel-empty">还没有安装 Skill。可以从下方精选列表安装，或导入自己的技能文件夹。</div>';
  $("skill-catalog").innerHTML = catalog.length
    ? catalog.map((skill) => `<article class="list-item skill-card catalog-card" title="${escapeHtml(skill.description)}"><div class="skill-card-top"><span class="skill-icon catalog">${icon("document")}</span><div><strong>${escapeHtml(skill.title)}</strong><small>${escapeHtml(skill.publisher)} · ${escapeHtml(skill.category)}</small></div></div><p>${escapeHtml(skill.description)}</p><div class="skill-card-footer"><code>${escapeHtml(skill.name)}</code><button class="small-button ${skill.installed ? "secondary-button" : ""}" type="button" data-install-catalog="${escapeHtml(skill.id)}" data-installed="${skill.installed}" ${skill.installed || state.skillBusy ? "disabled" : ""}>${skill.installed ? "已安装" : "安装"}</button></div></article>`).join("")
    : '<div class="panel-empty">没有匹配的 Skill</div>';
  syncSkillBusy();
}

function connectStream() {
  state.stream?.close();
  if (!state.current) return;
  const sessionId = state.current.id;
  const stream = new EventSource(`/api/sessions/${sessionId}/stream?projectId=${encodeURIComponent(state.projectId)}`);
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

async function selectSession(id, keepHome = false) {
  try {
    const fresh = await api(`/sessions/${id}`);
    state.current = fresh;
    if (!keepHome) { state.page = null; state.view = "task"; $("input").value = ""; setInspector(false); }
    updateNavigation();
    renderCurrent();
    connectStream();
  } catch (error) { notify(error.message, "error"); }
}

async function deleteSession(id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session || !await confirmInApp(`确定删除会话“${session.title}”吗？删除后无法恢复。`)) return;
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
  const [capabilities, knowledge, memorySearch, graph, schedules, mcp, skills, modelConfig, models] = await Promise.all([api("/capabilities"), api("/knowledge"), api("/memory?limit=30"), api("/knowledge-graph?limit=100"), api("/schedules"), api("/mcp"), api("/skills"), api("/config/model"), api("/models")]);
  Object.assign(state, { capabilities, knowledge, memorySearch, graph, schedules, mcp, skills, modelConfig, models });
  const runtime = await api("/config/runtime");
  $("memory-auto-learn").checked = runtime.memoryAutoLearn;
  $("command-network").checked = runtime.sandboxNetwork === "allow";
  renderModels(); renderRuntime(); renderKnowledge(); renderGraph(); renderSchedules(); renderMcp(); renderSkills(); renderModelConfig();
}

function renderModels() {
  const enabled = state.models.models.filter((entry) => entry.enabled);
  if (!enabled.some((entry) => entry.id === state.selectedModelId)) state.selectedModelId = enabled.find((entry) => entry.id === state.models.defaultModelId)?.id || enabled[0]?.id || "";
  if (state.selectedModelId) localStorage.setItem(modelStorageKey(), state.selectedModelId);
  else localStorage.removeItem(modelStorageKey());
  $("composer-model").innerHTML = enabled.length
    ? enabled.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`).join("")
    : '<option value="">体验模式</option>';
  $("composer-model").value = state.selectedModelId;
  $("composer-model-value").textContent = enabled.find((entry) => entry.id === state.selectedModelId)?.name || "体验模式";
  $("composer-model-menu").innerHTML = enabled.map((entry) => `<button class="composer-model-option ${entry.id === state.selectedModelId ? "selected" : ""}" type="button" role="option" aria-selected="${entry.id === state.selectedModelId}" data-select-model="${escapeHtml(entry.id)}"><span>${escapeHtml(entry.name)}</span><span class="smooth-select-check" aria-hidden="true">✓</span></button>`).join("") || '<div class="composer-model-empty">尚未启用模型</div>';
  const query = $("model-search").value.trim().toLocaleLowerCase();
  const visible = state.models.models.filter((entry) => !query || [entry.name, entry.model, entry.provider].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
  $("model-list").innerHTML = visible.length ? visible.map((entry) => `<article class="model-row" data-model-id="${escapeHtml(entry.id)}">
    <div class="model-identity"><span class="model-provider-mark">${icon("spark")}</span><div><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.model)}</small></div>${entry.isDefault ? '<span class="default-model-badge">默认</span>' : ""}</div>
    <div class="model-provider">${escapeHtml(entry.provider)}</div>
    <label class="model-state"><input class="model-toggle" type="checkbox" data-toggle-model="${escapeHtml(entry.id)}" ${entry.enabled ? "checked" : ""} /><span>${entry.enabled ? "已启用" : "已停用"}</span></label>
    <div class="model-actions"><button class="text-button" type="button" data-edit-model="${escapeHtml(entry.id)}">编辑</button>${entry.isDefault ? "" : `<button class="text-button" type="button" data-default-model="${escapeHtml(entry.id)}" ${entry.enabled ? "" : "disabled"}>设为默认</button>`}<button class="text-button danger-text" type="button" data-delete-model="${escapeHtml(entry.id)}">删除</button></div>
  </article>`).join("") : `<div class="model-empty">${state.models.models.length ? "没有匹配的模型" : "还没有配置模型。点击“新增模型”开始连接。"}</div>`;
  $("composer-model").disabled = !enabled.length || state.submitting || (state.view === "task" && state.current?.status === "running");
}

function renderPendingSources() {
  const container = $("pending-sources");
  container.classList.toggle("hidden", state.pendingSources.length === 0);
  container.innerHTML = state.pendingSources.map((source, index) => `<span class="source-chip" title="${escapeHtml(source.name)}">${icon("document")}<span>${escapeHtml(source.name)}</span><button type="button" data-remove-source="${index}" aria-label="移除资料：${escapeHtml(source.name)}" title="移除">${icon("close")}</button></span>`).join("");
  updateComposer();
}

const SOURCE_FILE_TYPES = new Set("txt md markdown csv tsv json yaml yml xml html htm log js mjs cjs ts tsx jsx py java c cpp h cs go rs sh sql css ini toml".split(" "));
const MAX_SOURCE_FILES = 5;
const MAX_SOURCE_FILE_BYTES = 3 * 1024 * 1024;
const MAX_SOURCE_TEXT = 50000;

async function parseSourceFile(file) {
  const extension = file.name.split(".").at(-1)?.toLowerCase() || "";
  if (!SOURCE_FILE_TYPES.has(extension)) throw new Error(`${file.name}：暂不支持此文件类型`);
  if (file.size > MAX_SOURCE_FILE_BYTES) throw new Error(`${file.name}：单个文件不能超过 3 MB`);
  let content = await file.text();
  if (extension === "html" || extension === "htm" || extension === "xml") {
    const document = new DOMParser().parseFromString(content, "text/html");
    document.querySelectorAll("script,style,noscript,svg").forEach((element) => element.remove());
    content = document.body.textContent || document.documentElement.textContent || "";
  }
  return { name: file.name, content: content.trim() };
}

function closeComposerModelMenu() {
  $("composer-model-menu").classList.remove("open");
  $("composer-model-trigger").setAttribute("aria-expanded", "false");
}

function openComposerModelMenu() {
  if ($("composer-model-trigger").disabled) return;
  const trigger = $("composer-model-trigger");
  const rect = trigger.getBoundingClientRect();
  const menu = $("composer-model-menu");
  menu.style.maxHeight = "";
  menu.classList.add("open");
  const height = Math.min(Math.max(menu.scrollHeight, 40), 240, Math.max(40, window.innerHeight - 16));
  menu.classList.add("drop-up");
  menu.style.maxHeight = `${height}px`;
  const width = Math.max(rect.width, 160);
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  menu.style.width = `${width}px`;
  menu.style.top = `${Math.max(8, rect.top - height - 6)}px`;
  trigger.setAttribute("aria-expanded", "true");
}

function openModelEditor(id = "") {
  const entry = state.models.models.find((model) => model.id === id);
  state.modelEditing = entry?.id || null;
  $("model-dialog-title").textContent = entry ? "编辑模型" : "新增模型";
  $("model-editor-id").value = entry?.id || "";
  $("model-editor-name").value = entry?.name || "";
  $("model-editor-model").value = entry?.model || "";
  const providerSelect = $("model-editor-provider");
  const providerValues = [...providerSelect.options].map((option) => option.value);
  const provider = entry?.provider || "OpenAI-compatible";
  const isKnownProvider = providerValues.includes(provider) && provider !== "自定义";
  providerSelect.value = isKnownProvider ? provider : "自定义";
  $("model-editor-provider-custom").value = isKnownProvider ? "" : provider;
  $("model-editor-provider-custom").classList.toggle("hidden", isKnownProvider);
  $("model-editor-provider-custom").required = !isKnownProvider;
  syncSmoothSelect(providerSelect);
  $("model-editor-base-url").value = entry?.baseUrl || "";
  $("model-editor-api-key").value = "";
  $("model-editor-api-key").placeholder = entry?.apiKeyConfigured ? "已设置，留空则保持不变" : "粘贴 API Key";
  $("model-editor-clear-key-row").classList.toggle("hidden", !entry?.apiKeyConfigured);
  $("model-editor-clear-key").checked = false;
  $("model-editor-temperature").value = entry?.temperature ?? "";
  $("model-editor-max-output").value = entry?.maxOutputTokens ?? "";
  $("model-editor-enabled").checked = entry?.enabled ?? true;
  $("model-editor-tools").checked = entry?.supportsTools ?? true;
  $("model-editor-vision").checked = entry?.supportsVision ?? false;
  $("model-editor-system-prompt").value = entry?.systemPrompt || "";
  $("model-editor-status").textContent = "";
  $("model-editor-status").className = "config-status";
  $("model-dialog").showModal();
  $("model-editor-name").focus();
}

const providerEndpoints = {
  "阿里千问": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  DeepSeek: "https://api.deepseek.com/v1",
  OpenAI: "https://api.openai.com/v1",
  Gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  "智谱 GLM": "https://open.bigmodel.cn/api/paas/v4",
  "Moonshot AI": "https://api.moonshot.cn/v1",
  豆包: "https://ark.cn-beijing.volces.com/api/v3",
  MiniMax: "https://api.minimaxi.com/v1",
  Groq: "https://api.groq.com/openai/v1",
  OpenRouter: "https://openrouter.ai/api/v1",
  Ollama: "http://localhost:11434/v1"
};

$("model-editor-provider").addEventListener("change", () => {
  const provider = $("model-editor-provider").value;
  const custom = provider === "自定义";
  $("model-editor-provider-custom").classList.toggle("hidden", !custom);
  $("model-editor-provider-custom").required = custom;
  if (custom) $("model-editor-provider-custom").focus();
  else if (providerEndpoints[provider] && !$("model-editor-id").value) $("model-editor-base-url").value = providerEndpoints[provider];
});

function closeModelEditor() {
  state.modelEditing = null;
  $("model-dialog").close();
}

async function updateModels(path, options, message) {
  try {
    state.models = await api(path, options);
    renderModels(); renderRuntime();
    notify(message);
    return true;
  } catch (error) {
    notify(error.message, "error");
    return false;
  }
}

function renderModelConfig() {
  const config = state.modelConfig;
  $("embedding-base-url").value = config.embeddingBaseUrl || "";
  $("embedding-model").value = config.embeddingModel || "";
  $("embedding-dimensions").value = config.embeddingDimensions || "";
  $("embedding-format").value = config.embeddingFormat || "auto";
  $("tool-policy").value = config.policy || "always-ask";
  syncSmoothSelect($("embedding-format"));
  syncSmoothSelect($("tool-policy"));
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
  $("model-config-status").textContent = "向量检索、联网工具和审批设置保存在本机，密钥不会再次显示。";
}

async function refreshMemory(query = "") {
  const [knowledge, memorySearch, graph] = await Promise.all([
    api("/knowledge"), api(`/memory?query=${encodeURIComponent(query)}&limit=30`), api(`/knowledge-graph?query=${encodeURIComponent(query)}&limit=100`)
  ]);
  Object.assign(state, { knowledge, memorySearch, graph });
  renderKnowledge(); renderGraph();
}

async function deleteMemory(id) {
  if (!await confirmInApp("确定删除这条结构化记忆吗？此操作无法撤销。")) return;
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
  document.querySelector(".app-shell").classList.toggle("inspector-open", open);
  $("inspector").classList.toggle("open", open);
  $("inspector-backdrop").classList.toggle("show", open);
  $("toggle-inspector").setAttribute("aria-expanded", String(open));
  $("inspector").inert = !open;
  updateNavigation();
}

function openPanel(name) {
  if (!panelNames[name]) return;
  if (workspacePages[name]) {
    state.page = name;
    setInspector(false);
    document.querySelectorAll("#workspace-panels [data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
    $("workspace-page-title").textContent = panelNames[name];
    $("workspace-page-description").textContent = workspacePages[name].description;
    $("workspace-page-icon").innerHTML = icon(workspacePages[name].icon);
    renderCurrent();
    $("workspace-page").scrollTop = 0;
    $("workspace-page-title").focus({ preventScroll: true });
    return;
  }
  state.page = null;
  renderCurrent();
  document.querySelectorAll("[data-tab]").forEach((item) => {
    const active = item.dataset.tab === name;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("#inspector [data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
  $("inspector-title").textContent = panelNames[name];
  setInspector(true);
  $("tab-" + name).scrollIntoView({ block: "nearest", inline: "nearest" });
}

function updateNavigation() {
  const selected = state.page;
  $("nav-home").classList.toggle("active", !selected);
  document.querySelectorAll(".workspace-nav [data-open-panel], .sidebar-bottom [data-open-panel]").forEach((button) => button.classList.toggle("active", button.dataset.openPanel === selected));
}

document.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => openPanel(tab.dataset.tab)));
document.querySelector(".tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const index = tabs.indexOf(document.activeElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  openPanel(tabs[next].dataset.tab);
  tabs[next].focus();
});

async function createSession() {
  const session = await api("/sessions", { method: "POST", body: "{}" });
  state.sessions.unshift(session);
  await selectSession(session.id);
  return session;
}

async function startProjectConversation(projectId) {
  try {
    const switched = await switchProject(projectId);
    if (!switched || state.projectId !== projectId || state.switchingProject) throw new Error("项目切换未完成，请重试");
    const session = await createSession();
    if (session.projectId && session.projectId !== projectId) throw new Error("新对话未关联到所选项目，请重试");
    setInspector(false);
    $("input").focus();
  } catch (error) { notify(error.message, "error"); }
}

$("new-session").addEventListener("click", async () => {
  try {
    await createSession();
    setInspector(false);
    $("input").focus();
  } catch (error) { notify(error.message, "error"); }
});

$("project-list").addEventListener("click", (event) => {
  const newChat = event.target.closest("[data-new-project-chat]");
  if (newChat) {
    void startProjectConversation(newChat.dataset.newProjectChat);
    return;
  }
  const option = event.target.closest("[data-project-id]");
  if (!option) return;
  void switchProject(option.dataset.projectId);
});
$("create-project").addEventListener("click", () => { void selectProjectFolder(); });
$("project-desktop-required-close").addEventListener("click", () => $("project-desktop-required-dialog").close());
$("project-desktop-required-ok").addEventListener("click", () => $("project-desktop-required-dialog").close());

async function confirmProjectImport() {
  const pending = pendingProjectImport;
  const name = $("project-import-name").value.trim();
  if (!pending || !name) return;
  const submit = $("project-import-confirm");
  submit.disabled = true;
  $("project-import-cancel").disabled = true;
  $("project-import-close").disabled = true;
  try {
    let result;
    if (pending.workspacePath) {
      $("project-import-status").textContent = "正在添加项目工作区…";
      result = await window.agentHarnessDesktop.registerProjectFolder({ name, workspacePath: pending.workspacePath });
      state.projects = result.projects || state.projects;
    } else {
      $("project-import-status").textContent = "正在导入项目文件，请稍候…";
      result = await importBrowserProject(pending.files, name, pending.totalBytes);
    }
    state.projects = result.projects || state.projects;
    renderProjects();
    pendingProjectImport = null;
    $("project-import-dialog").close();
    await switchProject(result.project.id);
    notify(pending.workspacePath ? "项目已添加" : `项目已导入 · ${result.importedFiles} 个文件`);
  } catch (error) {
    $("project-import-status").textContent = error.message;
    notify(error.message, "error");
    if (state.projects.some((project) => project.name === name)) renderProjects();
  } finally {
    submit.disabled = false;
    $("project-import-cancel").disabled = false;
    $("project-import-close").disabled = false;
  }
}

$("project-import-form").addEventListener("submit", (event) => { event.preventDefault(); void confirmProjectImport(); });
$("project-import-cancel").addEventListener("click", () => { pendingProjectImport = null; $("project-import-dialog").close(); });
$("project-import-close").addEventListener("click", () => { pendingProjectImport = null; $("project-import-dialog").close(); });
$("project-import-dialog").addEventListener("click", (event) => { if (event.target === $("project-import-dialog") && !$("project-import-confirm").disabled) { pendingProjectImport = null; $("project-import-dialog").close(); } });
async function saveRuntimeSetting(input) {
  try {
    const saved = await api("/config/runtime", { method: "PUT", body: JSON.stringify(input) });
    state.capabilities.policy = saved.policy;
    state.modelConfig.policy = saved.policy;
    state.capabilities.sandbox.network = saved.sandboxNetwork;
    $("tool-policy").value = saved.policy;
    syncSmoothSelect($("tool-policy"));
    $("memory-auto-learn").checked = saved.memoryAutoLearn;
    $("command-network").checked = saved.sandboxNetwork === "allow";
    renderRuntime();
    notify("设置已保存并立即生效");
  } catch (error) {
    const runtime = await api("/config/runtime");
    $("approval-mode").value = runtime.policy;
    syncSmoothSelect($("approval-mode"));
    $("memory-auto-learn").checked = runtime.memoryAutoLearn;
    $("command-network").checked = runtime.sandboxNetwork === "allow";
    notify(error.message, "error");
  }
}
$("approval-mode").addEventListener("change", () => { void saveRuntimeSetting({ policy: $("approval-mode").value }); });
$("memory-auto-learn").addEventListener("change", () => { void saveRuntimeSetting({ memoryAutoLearn: $("memory-auto-learn").checked }); });
$("command-network").addEventListener("change", () => { void saveRuntimeSetting({ sandboxNetwork: $("command-network").checked ? "allow" : "none" }); });

$("composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("input");
  const value = input.value.trim() || (state.pendingSources.length ? "请阅读我附加的资料，并根据内容完成任务。" : "");
  if (!value || state.submitting || input.disabled) return;
  state.submitting = true;
  updateComposer();
  try {
    const targetSession = !state.current || state.view === "home" ? await createSession() : state.current;
    state.focusUserMessage = { sessionId: targetSession.id, afterCount: targetSession.messages.filter((message) => message.role === "user").length };
    await api(`/sessions/${targetSession.id}/tasks`, { method: "POST", body: JSON.stringify({ text: value, sources: state.pendingSources, modelId: state.selectedModelId || undefined }) });
    input.value = "";
    state.pendingSources = [];
    renderPendingSources();
    await refreshSession(targetSession.id);
  } catch (error) { state.focusUserMessage = null; input.value = value; notify(error.message, "error"); }
  finally { state.submitting = false; renderCurrent(); }
});

$("add-source").addEventListener("click", () => $("source-files").click());
$("source-files").addEventListener("change", async (event) => {
  const files = [...event.target.files || []];
  event.target.value = "";
  if (!files.length) return;
  if (state.pendingSources.length + files.length > MAX_SOURCE_FILES) return notify(`一次最多添加 ${MAX_SOURCE_FILES} 个资料文件`, "error");
  try {
    const parsed = await Promise.all(files.map(parseSourceFile));
    const remaining = MAX_SOURCE_TEXT - state.pendingSources.reduce((sum, source) => sum + source.content.length, 0);
    const nextTotal = parsed.reduce((sum, source) => sum + source.content.length, 0);
    if (nextTotal > remaining) throw new Error(`本次任务的资料文本最多 ${MAX_SOURCE_TEXT.toLocaleString()} 个字符`);
    state.pendingSources.push(...parsed);
    renderPendingSources();
    notify(`已解析 ${parsed.length} 个资料文件`);
  } catch (error) { notify(error.message, "error"); }
});
$("pending-sources").addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove-source]");
  if (!remove) return;
  state.pendingSources.splice(Number(remove.dataset.removeSource), 1);
  renderPendingSources();
});
$("composer-model-trigger").addEventListener("click", () => $("composer-model-menu").classList.contains("open") ? closeComposerModelMenu() : openComposerModelMenu());
$("composer-model-menu").addEventListener("click", (event) => {
  const option = event.target.closest("[data-select-model]");
  if (!option) return;
  $("composer-model").value = option.dataset.selectModel;
  $("composer-model").dispatchEvent(new Event("change", { bubbles: true }));
  closeComposerModelMenu();
});
$("composer-model-trigger").addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp", "Enter", " ", "Escape"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Escape") return closeComposerModelMenu();
  if (!$ ("composer-model-menu").classList.contains("open")) openComposerModelMenu();
  $("composer-model-menu").querySelector("[data-select-model]")?.focus();
});
$("composer-model-menu").addEventListener("keydown", (event) => {
  const options = [...$("composer-model-menu").querySelectorAll("[data-select-model]")];
  const index = options.indexOf(document.activeElement);
  if (event.key === "Escape") { event.preventDefault(); closeComposerModelMenu(); $("composer-model-trigger").focus(); }
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); document.activeElement.closest("[data-select-model]")?.click(); }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    options[Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
  }
});
document.addEventListener("pointerdown", (event) => { if (!event.target.closest(".composer-model-wrap")) closeComposerModelMenu(); });
window.addEventListener("resize", () => { if ($("composer-model-menu").classList.contains("open")) openComposerModelMenu(); });
document.addEventListener("scroll", () => { if ($("composer-model-menu").classList.contains("open")) openComposerModelMenu(); }, true);

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
  await mutateMcp("/mcp/refresh", { method: "POST", body: "{}" }, "MCP 状态已刷新");
});

function syncMcpBusy() {
  document.querySelectorAll("#mcp-view button").forEach((button) => { button.disabled = state.mcpBusy; });
  $("save-mcp").textContent = state.mcpBusy ? "正在保存与连接…" : "保存并连接";
}

function setToolTab(tab) {
  state.toolTab = tab === "skills" ? "skills" : "mcp";
  document.querySelectorAll("[data-tool-tab]").forEach((button) => {
    const active = button.dataset.toolTab === state.toolTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("mcp-view").classList.toggle("hidden", state.toolTab !== "mcp");
  $("skills-view").classList.toggle("hidden", state.toolTab !== "skills");
}

function syncSkillBusy() {
  document.querySelectorAll("#skills-view button").forEach((button) => {
    button.disabled = state.skillBusy || button.dataset.installed === "true";
  });
  $("skill-folder-input").disabled = state.skillBusy;
  const submit = $("skill-github-form").querySelector('button[type="submit"]');
  submit.textContent = state.skillBusy ? "正在安装…" : "从 GitHub 安装";
}

async function mutateSkills(path, options, message) {
  if (state.skillBusy) return false;
  state.skillBusy = true;
  $("skill-status").textContent = "正在处理，请稍候…";
  $("skill-status").className = "config-status";
  syncSkillBusy();
  try {
    state.skills = await api(path, typeof options === "function" ? await options() : options);
    state.knowledge.skills = state.skills.installed;
    $("skill-status").textContent = message;
    $("skill-status").className = "config-status success";
    renderSkills();
    notify(message);
    return true;
  } catch (error) {
    $("skill-status").textContent = error.message;
    $("skill-status").className = "config-status error";
    notify(error.message, "error");
    return false;
  } finally {
    state.skillBusy = false;
    syncSkillBusy();
  }
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result).split(",", 2)[1] || ""), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error(`无法读取 ${file.name}`)), { once: true });
    reader.readAsDataURL(file);
  });
}

document.querySelectorAll("[data-tool-tab]").forEach((button) => button.addEventListener("click", () => setToolTab(button.dataset.toolTab)));
$("skill-search").addEventListener("input", renderSkills);
$("skill-github-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const installed = await mutateSkills("/skills/install", { method: "POST", body: JSON.stringify({ source: "github", url: $("skill-github-url").value.trim() }) }, "Skill 已从 GitHub 安装");
  if (installed) event.target.reset();
});
$("skill-folder-input").addEventListener("change", async (event) => {
  const selected = [...event.target.files];
  if (!selected.length || state.skillBusy) return;
  if (selected.length > 200) { notify("Skill 文件不能超过 200 个", "error"); event.target.value = ""; return; }
  if (selected.some((file) => file.size > 2 * 1024 * 1024) || selected.reduce((sum, file) => sum + file.size, 0) > 12 * 1024 * 1024) {
    notify("Skill 单文件不能超过 2 MB，总大小不能超过 12 MB", "error"); event.target.value = ""; return;
  }
  try {
    await mutateSkills("/skills/install", async () => {
      const files = await Promise.all(selected.map(async (file) => ({ path: file.webkitRelativePath || file.name, content: await fileAsBase64(file), encoding: "base64" })));
      return { method: "POST", body: JSON.stringify({ source: "files", files }) };
    }, "Skill 文件夹已导入");
  } catch (error) {
    $("skill-status").textContent = error.message;
    $("skill-status").className = "config-status error";
    notify(error.message, "error");
  } finally { event.target.value = ""; }
});
$("skill-catalog").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-install-catalog]");
  if (!button || button.disabled) return;
  await mutateSkills("/skills/install", { method: "POST", body: JSON.stringify({ source: "catalog", id: button.dataset.installCatalog }) }, "精选 Skill 已安装");
});
$("installed-skills").addEventListener("click", async (event) => {
  const view = event.target.closest("[data-view-skill]");
  if (view) {
    try {
      const details = await api(`/skills/${encodeURIComponent(view.dataset.viewSkill)}`);
      $("skill-dialog-title").textContent = details.title || details.name;
      $("skill-dialog-files").textContent = `${details.files.length} 个文件 · ${details.files.join("  ·  ")}`;
      $("skill-dialog-content").textContent = details.content;
      $("skill-dialog").showModal();
    } catch (error) { notify(error.message, "error"); }
    return;
  }
  const toggle = event.target.closest("[data-toggle-skill]");
  const remove = event.target.closest("[data-delete-skill]");
  const name = toggle?.dataset.toggleSkill || remove?.dataset.deleteSkill;
  if (!name) return;
  if (remove && !await confirmInApp(`确定卸载 Skill“${name}”吗？`, { title: "卸载 Skill", confirmText: "确认卸载" })) return;
  const skill = state.skills.installed.find((item) => item.name === name);
  await mutateSkills(`/skills/${encodeURIComponent(name)}`, { method: remove ? "DELETE" : "PUT", ...(remove ? {} : { body: JSON.stringify({ enabled: !skill.enabled }) }) }, remove ? "Skill 已卸载" : "Skill 状态已更新");
});
$("close-skill-dialog").addEventListener("click", () => $("skill-dialog").close());
$("skill-dialog").addEventListener("click", (event) => { if (event.target === $("skill-dialog")) $("skill-dialog").close(); });

function openMcpEditor(name = null) {
  const server = state.mcp.find((item) => item.name === name);
  state.mcpEditing = server?.name || null;
  $("mcp-form").reset();
  $("mcp-editor").classList.remove("hidden");
  $("mcp-editor-title").textContent = server ? "编辑 MCP 服务" : "添加 MCP 服务";
  $("mcp-name").value = server?.name || "";
  $("mcp-url").required = !server;
  $("mcp-url").placeholder = server?.url || "https://example.com/mcp";
  $("mcp-url-hint").textContent = server ? "留空保留原地址（包括已保存的密钥）；填写新地址则替换" : "填写服务提供方的 HTTP / HTTPS MCP 地址";
  $("mcp-enabled").checked = server?.enabled !== false;
  $("mcp-auth").open = Boolean(server?.headerNames?.length);
  $("mcp-clear-headers-row").classList.toggle("hidden", !server?.headerNames?.length);
  $("mcp-headers-hint").textContent = server?.headerNames?.length ? `已配置：${server.headerNames.join("、")}。留空保留，填写 JSON 则替换全部请求头。` : "无需验证时留空。密钥保存后不会回显。";
  $("mcp-form-status").textContent = "";
  $("mcp-form-status").className = "config-status";
  $("mcp-name").focus();
}

function closeMcpEditor() {
  $("mcp-editor").classList.add("hidden");
  $("mcp-form").reset();
  state.mcpEditing = null;
}

async function mutateMcp(path, options, message) {
  if (state.mcpBusy) return false;
  state.mcpBusy = true;
  syncMcpBusy();
  try {
    state.mcp = await api(path, options);
    renderMcp();
    notify(message);
    return true;
  } catch (error) {
    $("mcp-form-status").textContent = error.message;
    $("mcp-form-status").className = "config-status error";
    notify(error.message, "error");
    return false;
  } finally {
    state.mcpBusy = false;
    syncMcpBusy();
  }
}

$("add-mcp").addEventListener("click", () => openMcpEditor());
$("cancel-mcp").addEventListener("click", closeMcpEditor);
$("mcp-headers").addEventListener("input", () => { if ($("mcp-headers").value.trim()) $("mcp-clear-headers").checked = false; });
$("mcp-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.mcpBusy) return;
  let headers;
  try {
    const text = $("mcp-headers").value.trim();
    headers = $("mcp-clear-headers").checked ? {} : text ? JSON.parse(text) : undefined;
    if (headers !== undefined && (!headers || Array.isArray(headers) || typeof headers !== "object" || Object.values(headers).some((value) => typeof value !== "string"))) throw new Error();
  } catch {
    $("mcp-form-status").textContent = '请求头需要填写 JSON 对象，例如 {"Authorization": "Bearer your-token"}';
    $("mcp-form-status").className = "config-status error";
    return;
  }
  const editing = state.mcpEditing;
  const saved = await mutateMcp(editing ? `/mcp/servers/${encodeURIComponent(editing)}` : "/mcp/servers", {
    method: editing ? "PUT" : "POST",
    body: JSON.stringify({ name: $("mcp-name").value.trim(), url: $("mcp-url").value.trim() || undefined, headers, enabled: $("mcp-enabled").checked }),
  }, "MCP 配置已保存，连接状态已更新");
  if (saved) closeMcpEditor();
});

$("mcp-servers").addEventListener("click", async (event) => {
  if (state.mcpBusy) return;
  const edit = event.target.closest("[data-edit-mcp]");
  if (edit) return openMcpEditor(edit.dataset.editMcp);
  const toggle = event.target.closest("[data-toggle-mcp]");
  const remove = event.target.closest("[data-delete-mcp]");
  const name = toggle?.dataset.toggleMcp || remove?.dataset.deleteMcp;
  if (!name) return;
  if (remove && !await confirmInApp(`确定移除 MCP 服务“${name}”吗？`, { title: "移除 MCP 服务", confirmText: "确认移除" })) return;
  const server = state.mcp.find((item) => item.name === name);
  const saved = await mutateMcp(`/mcp/servers/${encodeURIComponent(name)}`, { method: remove ? "DELETE" : "PUT", ...(remove ? {} : { body: JSON.stringify({ enabled: server.enabled === false }) }) }, remove ? "MCP 服务已移除" : "服务状态已更新");
  if (saved && state.mcpEditing === name) closeMcpEditor();
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
      policy: $("tool-policy").value
    }) });
    state.modelConfig = modelConfig;
    [state.capabilities, state.mcp] = await Promise.all([api("/capabilities"), api("/mcp")]);
    renderModelConfig(); renderRuntime(); renderMcp();
    status.className = "config-status success";
    status.textContent = "能力设置已保存并立即应用。";
    notify("能力设置已保存");
  } catch (error) {
    status.className = "config-status error";
    status.textContent = error.message;
  }
});

document.querySelectorAll("[data-model-settings-tab]").forEach((button) => button.addEventListener("click", () => {
  state.modelSettingsTab = button.dataset.modelSettingsTab;
  document.querySelectorAll("[data-model-settings-tab]").forEach((tab) => {
    const active = tab === button;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  $("model-list-view").classList.toggle("hidden", state.modelSettingsTab !== "models");
  $("model-list-actions").classList.toggle("hidden", state.modelSettingsTab !== "models");
  $("model-capabilities-view").classList.toggle("hidden", state.modelSettingsTab !== "capabilities");
}));

$("model-search").addEventListener("input", renderModels);
$("add-model").addEventListener("click", () => openModelEditor());
$("composer-model").addEventListener("change", () => {
  state.selectedModelId = $("composer-model").value;
  if (state.selectedModelId) localStorage.setItem("agent-harness-model", state.selectedModelId);
  else localStorage.removeItem("agent-harness-model");
  const selected = state.models.models.find((entry) => entry.id === state.selectedModelId && entry.enabled);
  $("composer-model-value").textContent = selected?.name || "体验模式";
  $("composer-model-menu").querySelectorAll("[data-select-model]").forEach((option) => {
    const active = option.dataset.selectModel === state.selectedModelId;
    option.classList.toggle("selected", active);
    option.setAttribute("aria-selected", String(active));
  });
  renderRuntime();
});
$("model-list").addEventListener("change", async (event) => {
  const toggle = event.target.closest("[data-toggle-model]");
  if (!toggle) return;
  toggle.disabled = true;
  await updateModels(`/models/${encodeURIComponent(toggle.dataset.toggleModel)}`, { method: "PUT", body: JSON.stringify({ enabled: toggle.checked }) }, toggle.checked ? "模型已启用" : "模型已停用");
});
$("model-list").addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit-model]");
  if (edit) return openModelEditor(edit.dataset.editModel);
  const makeDefault = event.target.closest("[data-default-model]");
  if (makeDefault) return void updateModels("/models/default", { method: "PUT", body: JSON.stringify({ id: makeDefault.dataset.defaultModel }) }, "默认模型已更新");
  const remove = event.target.closest("[data-delete-model]");
  if (!remove) return;
  const entry = state.models.models.find((model) => model.id === remove.dataset.deleteModel);
  if (!await confirmInApp(`确定删除模型“${entry?.name || "未命名模型"}”吗？`, { title: "删除模型" })) return;
  await updateModels(`/models/${encodeURIComponent(remove.dataset.deleteModel)}`, { method: "DELETE", body: "{}" }, "模型已删除");
});

$("model-editor-api-key").addEventListener("input", () => { if ($("model-editor-api-key").value) $("model-editor-clear-key").checked = false; });
$("close-model-dialog").addEventListener("click", closeModelEditor);
$("cancel-model-editor").addEventListener("click", closeModelEditor);
$("model-dialog").addEventListener("click", (event) => { if (event.target === $("model-dialog")) closeModelEditor(); });
$("model-editor-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("model-editor-status");
  status.className = "config-status";
  status.textContent = "正在保存…";
  const id = $("model-editor-id").value;
  try {
    state.models = await api(id ? `/models/${encodeURIComponent(id)}` : "/models", { method: id ? "PUT" : "POST", body: JSON.stringify({
      name: $("model-editor-name").value,
      model: $("model-editor-model").value,
      provider: $("model-editor-provider").value === "自定义" ? $("model-editor-provider-custom").value.trim() : $("model-editor-provider").value,
      baseUrl: $("model-editor-base-url").value,
      apiKey: $("model-editor-api-key").value,
      clearApiKey: $("model-editor-clear-key").checked,
      temperature: $("model-editor-temperature").value,
      maxOutputTokens: $("model-editor-max-output").value,
      enabled: $("model-editor-enabled").checked,
      supportsTools: $("model-editor-tools").checked,
      supportsVision: $("model-editor-vision").checked,
      systemPrompt: $("model-editor-system-prompt").value
    }) });
    renderModels(); renderRuntime(); closeModelEditor();
    notify(id ? "模型配置已更新" : "模型已添加");
  } catch (error) {
    status.className = "config-status error";
    status.textContent = error.message;
  }
});

$("toggle-inspector").addEventListener("click", () => $("inspector").classList.contains("open") ? setInspector(false) : openPanel("runtime"));
$("close-inspector").addEventListener("click", () => { setInspector(false); $("toggle-inspector").focus(); });
$("inspector-backdrop").addEventListener("click", () => setInspector(false));
$("input").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("composer").requestSubmit(); } });
$("input").addEventListener("input", updateComposer);

$("nav-home").addEventListener("click", () => {
  state.page = null;
  state.view = "home";
  $("input").value = "";
  setInspector(false);
  renderCurrent();
});

document.addEventListener("click", async (event) => {
  const panelButton = event.target.closest("[data-open-panel]");
  if (panelButton) openPanel(panelButton.dataset.openPanel);
  const recent = event.target.closest("[data-recent-session]");
  if (recent) await selectSession(recent.dataset.recentSession);
  const starter = event.target.closest("[data-starter]");
  if (starter) {
    // A template always starts a new task instead of altering a previous conversation.
    state.page = null;
    state.view = "home";
    renderCurrent();
    $("input").value = starters[Number(starter.dataset.starter)].prompt;
    updateComposer();
    $("input").focus();
  }
  if (event.target.closest("[data-focus-composer]")) $("input").focus();
  if (event.target.closest("[data-open-search]")) openSearch();
});

function renderSearch() {
  const query = $("command-input").value.trim().toLocaleLowerCase();
  const commands = [
    { label: "新建任务", detail: "开始一个新的想法", icon: "plus", action: "new" },
    { label: "返回工作台", detail: "灵感与最近任务", icon: "grid", action: "home" },
    ...Object.entries(panelNames).map(([panel, label]) => ({ label, detail: "工作空间功能", icon: panel === "config" ? "settings" : "spark", panel })),
    ...state.sessions.map((session) => ({ label: session.title === "New Session" ? "未命名任务" : session.title, detail: `最近任务 · ${formatTime(session.updatedAt)}`, icon: "document", session: session.id })),
  ].filter((item) => `${item.label} ${item.detail}`.toLocaleLowerCase().includes(query)).slice(0, 12);
  $("command-results").innerHTML = commands.length ? commands.map((item) => `<button type="button" class="command-result" ${item.action ? `data-command-action="${item.action}"` : item.panel ? `data-command-panel="${item.panel}"` : `data-command-session="${escapeHtml(item.session)}"`}>${icon(item.icon)}<span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span>${icon("chevron")}</button>`).join("") : '<div class="panel-empty">没有找到结果，换个关键词试试。</div>';
}

function openSearch() {
  $("command-input").value = "";
  renderSearch();
  if (!$("command-dialog").open) $("command-dialog").showModal();
  $("command-input").focus();
}

$("open-search").addEventListener("click", openSearch);
$("close-search").addEventListener("click", () => $("command-dialog").close());
$("command-input").addEventListener("input", renderSearch);
$("command-dialog").addEventListener("click", (event) => {
  const button = event.target.closest(".command-result");
  if (!button) return;
  $("command-dialog").close();
  if (button.dataset.commandAction === "new") $("new-session").click();
  if (button.dataset.commandAction === "home") $("nav-home").click();
  if (button.dataset.commandPanel) openPanel(button.dataset.commandPanel);
  if (button.dataset.commandSession) void selectSession(button.dataset.commandSession);
});
$("command-dialog").addEventListener("keydown", (event) => {
  const results = [...$("command-results").querySelectorAll("button")];
  const index = results.indexOf(document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = index < 0 ? event.key === "ArrowDown" ? 0 : results.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
    results[next]?.focus();
  }
  if (event.key === "Enter" && document.activeElement === $("command-input")) { event.preventDefault(); results[0]?.click(); }
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openSearch(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n" && !event.repeat) { event.preventDefault(); $("command-dialog").close(); $("new-session").click(); }
  if (event.key === "Escape" && !$("command-dialog").open && !event.target.closest(".smooth-select.open")) setInspector(false);
});

$("messages").addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-tool-result-key]");
  if (!toggle) return;
  const key = toggle.dataset.toolResultKey;
  const result = toggle.closest(".tool-result");
  const expanded = !result.classList.contains("expanded");
  result.classList.toggle("expanded", expanded);
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.querySelector(".tool-result-action").childNodes[0].textContent = expanded ? "收起" : "展开";
  if (expanded) state.expandedToolResults.add(key);
  else state.expandedToolResults.delete(key);
});
$("messages").addEventListener("pointerup", (event) => {
  const content = event.target.closest(".tool-result.expanded .tool-result-content");
  if (!content) return;
  const key = content.closest(".tool-result").querySelector("[data-tool-result-key]").dataset.toolResultKey;
  state.toolResultHeights.set(key, Math.round(content.getBoundingClientRect().height));
});

document.querySelectorAll("[data-icon]").forEach((element) => { element.innerHTML = icon(element.dataset.icon); });
document.querySelectorAll("[data-panel]").forEach((panel) => {
  const name = panel.dataset.panel;
  panel.id = `panel-${name}`;
  if (workspacePages[name]) {
    $("workspace-panels").append(panel);
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", panelNames[name]);
  } else {
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `tab-${name}`);
  }
});
setInspector(false);
setupSmoothSelects();
renderCurrent();

try {
  const projectResult = await api("/projects");
  state.projects = projectResult.projects || [];
  if (!state.projects.some((project) => project.id === state.projectId)) state.projectId = "default";
  renderProjects();
  state.selectedModelId = localStorage.getItem(modelStorageKey()) || "";
  [state.sessions] = await Promise.all([api("/sessions"), loadControlData()]);
  if (state.sessions.length) await selectSession(state.sessions[0].id, true);
  else renderCurrent();
} catch (error) {
  notify(error.message, "error");
} finally {
  document.body.dataset.ready = "true";
}
