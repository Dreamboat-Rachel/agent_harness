import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class McpManager {
  constructor(dataRoot, { environment = process.env } = {}) {
    this.file = path.join(dataRoot, "mcp.json");
    this.servers = [];
    this.tools = new Map();
    this.environment = { ...environment };
    this.pending = Promise.resolve();
  }

  configureEnvironment(values = {}) { Object.assign(this.environment, values); }

  async init() {
    return this.serialize(async () => {
      const config = await this.readConfig();
      this.servers = config.servers.map((server) => ({ ...server }));
      await this.refreshConnections();
    });
  }

  serialize(operation) {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }

  async readConfig() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (!parsed || !Array.isArray(parsed.servers) || parsed.servers.some((server) => !server?.name || !server?.url)) throw new Error("mcp.json 格式无效：需要 servers 服务列表");
      return parsed;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const defaults = defaultConfig();
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
      return defaults;
    }
  }

  async saveServer(input, existingName = null) {
    return this.serialize(async () => {
      const config = await this.readConfig();
      const index = existingName === null ? -1 : config.servers.findIndex((server) => server.name === existingName);
      if (existingName !== null && index < 0) throw configError("MCP 服务不存在", 404);
      const server = validateServer(input, index < 0 ? undefined : config.servers[index]);
      if (config.servers.some((entry, at) => at !== index && entry.name === server.name)) throw configError("服务名称已存在，请使用其他名称", 409);
      if (index < 0) config.servers.push(server);
      else config.servers[index] = server;
      await this.writeConfig(config);
      return this.status();
    });
  }

  async deleteServer(name) {
    return this.serialize(async () => {
      const config = await this.readConfig();
      const index = config.servers.findIndex((server) => server.name === name);
      if (index < 0) throw configError("MCP 服务不存在", 404);
      config.servers.splice(index, 1);
      await this.writeConfig(config);
      return this.status();
    });
  }

  async writeConfig(config) {
    const staging = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(staging, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.rename(staging, this.file);
    } finally { await fs.rm(staging, { force: true }); }
    this.servers = config.servers.map((server) => ({ ...server }));
    await this.refreshConnections();
  }

  async refresh() { return this.serialize(() => this.refreshConnections()); }

  async refreshConnections() {
    this.tools.clear();
    await Promise.all(this.servers.map(async (server) => {
      delete server.error;
      delete server.sessionId;
      delete server.protocolVersion;
      delete server.resolvedUrl;
      if (server.enabled === false) return;
      try {
        server.resolvedUrl = expandEnvironment(server.url, this.environment);
        const initialized = await this.rpc(server, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "penguin-replica", version: "0.2.0" } }, { captureSession: true });
        server.protocolVersion = initialized.protocolVersion || "2025-03-26";
        await this.rpc(server, "notifications/initialized", {}, { notification: true });
        const listed = await this.rpc(server, "tools/list", {});
        for (const tool of listed.tools || []) this.tools.set(`mcp__${server.name}__${tool.name}`, { server, tool });
      } catch (error) {
        server.error = /^(missing environment variable: [A-Za-z_][A-Za-z0-9_]*|MCP .+: HTTP \d+)$/.test(error.message) ? error.message : "连接失败，请检查地址、请求头或服务状态";
      }
    }));
  }

  definitions() {
    return [...this.tools.entries()].map(([name, entry]) => ({
      type: "function",
      function: { name, description: entry.tool.description || `MCP tool ${entry.tool.name}`, parameters: entry.tool.inputSchema || { type: "object" } }
    }));
  }

  async call(name, args) {
    const entry = this.tools.get(name);
    if (!entry) throw new Error(`unknown MCP tool: ${name}`);
    const result = await this.rpc(entry.server, "tools/call", { name: entry.tool.name, arguments: args });
    return (result.content || []).map((item) => item.text || JSON.stringify(item)).join("\n") || JSON.stringify(result);
  }

  status() {
    return this.servers.map((server) => ({ name: server.name, url: redactUrl(server.url), enabled: server.enabled !== false, headerNames: Object.keys(server.headers || {}), error: server.error || null, connected: Boolean(server.enabled !== false && !server.error && server.resolvedUrl), tools: [...this.tools.values()].filter((entry) => entry.server === server).length }));
  }

  async rpc(server, method, params, { captureSession = false, notification = false } = {}) {
    const payload = { jsonrpc: "2.0", ...(notification ? {} : { id: randomUUID() }), method, params };
    const response = await fetch(server.resolvedUrl || expandEnvironment(server.url, this.environment), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(server.sessionId ? { "mcp-session-id": server.sessionId } : {}), ...(server.protocolVersion ? { "mcp-protocol-version": server.protocolVersion } : {}), ...(server.headers || {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`MCP ${server.name}: HTTP ${response.status}`);
    if (captureSession) server.sessionId = response.headers.get("mcp-session-id") || "";
    if (notification && (response.status === 202 || !response.headers.get("content-type"))) { await response.body?.cancel(); return {}; }
    const text = await response.text();
    if (!text.trim()) return {};
    const responsePayload = response.headers.get("content-type")?.includes("text/event-stream")
      ? text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5).trim())).find((item) => item.result || item.error)
      : JSON.parse(text);
    if (responsePayload?.error) throw new Error(responsePayload.error.message || "MCP request failed");
    return responsePayload?.result || {};
  }
}

function expandEnvironment(value, environment) {
  return String(value).replace(/(?:\$\{|\{\{)([A-Za-z_][A-Za-z0-9_]*)(?:\}\}|\})/g, (_, name) => {
    const replacement = environment[name];
    if (!replacement) throw new Error(`missing environment variable: ${name}`);
    return encodeURIComponent(String(replacement));
  });
}

function defaultConfig() {
  return {
    servers: [{
      name: "amap-maps",
      url: "https://mcp.amap.com/mcp?key={{AMAP_MAPS_API_KEY}}",
      enabled: true
    }]
  };
}

function redactUrl(value) {
  return String(value).replace(/(https?:\/\/)[^/@]+@/i, "$1***@").replace(/([?&][^=&]+)=([^&#]+)/g, (_, prefix, secret) => `${prefix}=${/^(\{\{[\w]+\}\}|\$\{[\w]+\})$/.test(secret) ? secret : "***"}`);
}

function configError(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }

function validateServer(input, current = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw configError("请填写有效的 MCP 服务配置");
  const server = { ...current };
  if (input.name !== undefined) server.name = typeof input.name === "string" ? input.name.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(server.name || "")) throw configError("服务名称需为 1–64 位英文字母、数字、短横线或下划线");
  if (input.url !== undefined) server.url = typeof input.url === "string" ? input.url.trim() : "";
  try {
    const url = new URL(server.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || server.url.includes("***")) throw new Error();
  } catch { throw configError("请填写有效的 HTTP / HTTPS MCP 地址，身份验证请使用请求头"); }
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw configError("启用状态必须为布尔值");
  server.enabled = input.enabled ?? server.enabled ?? true;
  if (input.headers !== undefined) {
    if (!input.headers || typeof input.headers !== "object" || Array.isArray(input.headers)) throw configError("请求头必须为 JSON 对象");
    for (const [name, value] of Object.entries(input.headers)) {
      if (typeof value !== "string" || !name.trim() || /^(host|content-length|connection|transfer-encoding)$/i.test(name)) throw configError("请求头名称或内容无效");
      try { new Headers({ [name]: value }); } catch { throw configError("请求头名称或内容无效"); }
    }
    server.headers = { ...input.headers };
  }
  return server;
}
