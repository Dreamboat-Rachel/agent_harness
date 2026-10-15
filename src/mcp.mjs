import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class McpManager {
  constructor(dataRoot, { environment = process.env } = {}) {
    this.file = path.join(dataRoot, "mcp.json");
    this.servers = [];
    this.tools = new Map();
    this.environment = { ...environment };
  }

  configureEnvironment(values = {}) { Object.assign(this.environment, values); }

  async init() {
    this.servers = [];
    this.tools.clear();
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      this.servers = Array.isArray(parsed.servers) ? parsed.servers.filter((server) => server?.name && server?.url && server.enabled !== false) : [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const defaults = defaultConfig();
      await fs.writeFile(this.file, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
      this.servers = defaults.servers;
    }
    await this.refresh();
  }

  async refresh() {
    this.tools.clear();
    await Promise.all(this.servers.map(async (server) => {
      delete server.error;
      delete server.sessionId;
      delete server.protocolVersion;
      delete server.resolvedUrl;
      try {
        server.resolvedUrl = expandEnvironment(server.url, this.environment);
        const initialized = await this.rpc(server, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "penguin-replica", version: "0.2.0" } }, { captureSession: true });
        server.protocolVersion = initialized.protocolVersion || "2025-03-26";
        await this.rpc(server, "notifications/initialized", {}, { notification: true });
        const listed = await this.rpc(server, "tools/list", {});
        for (const tool of listed.tools || []) this.tools.set(`mcp__${server.name}__${tool.name}`, { server, tool });
      } catch (error) {
        server.error = error.message;
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
    return this.servers.map((server) => ({ name: server.name, url: redactUrl(server.url), error: server.error || null, connected: Boolean(!server.error && server.resolvedUrl), tools: [...this.tools.values()].filter((entry) => entry.server === server).length }));
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
  return String(value).replace(/([?&](?:key|api_key|token)=)([^&]+)/gi, (_, prefix, secret) => secret.includes("{{") || secret.includes("${") ? `${prefix}${secret}` : `${prefix}***`);
}
