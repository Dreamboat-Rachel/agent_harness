import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpManager } from "../src/mcp.mjs";

test("MCP manager expands the AMap key and preserves Streamable HTTP sessions", async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-mcp-"));
  const received = [];
  const server = http.createServer(async (req, res) => {
    const payload = JSON.parse(await body(req));
    received.push({ url: req.url, session: req.headers["mcp-session-id"], payload });
    if (payload.method === "initialize") {
      res.setHeader("mcp-session-id", "amap-session-1");
      return json(res, { jsonrpc: "2.0", id: payload.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "amap-test", version: "1" } } });
    }
    assert.equal(req.headers["mcp-session-id"], "amap-session-1");
    assert.equal(req.headers["mcp-protocol-version"], "2025-03-26");
    if (payload.method === "notifications/initialized") { res.statusCode = 202; return res.end(); }
    if (payload.method === "tools/list") return json(res, { jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "maps_geo", description: "地理编码", inputSchema: { type: "object", properties: { address: { type: "string" } } } }] } });
    if (payload.method === "tools/call") return json(res, { jsonrpc: "2.0", id: payload.id, result: { content: [{ type: "text", text: "北京市朝阳区" }] } });
    res.statusCode = 404; res.end();
  });
  const base = await listen(server);
  await fs.writeFile(path.join(dataRoot, "mcp.json"), JSON.stringify({ servers: [{ name: "amap-maps", url: `${base}/mcp?key={{AMAP_MAPS_API_KEY}}`, enabled: true }] }), "utf8");
  const manager = new McpManager(dataRoot, { environment: { AMAP_MAPS_API_KEY: "key with spaces" } });
  t.after(async () => { server.close(); await fs.rm(dataRoot, { recursive: true, force: true }); });

  await manager.init();
  assert.equal(manager.status()[0].tools, 1);
  assert.equal(manager.status()[0].url.includes("key with spaces"), false);
  assert.equal(received[0].url, "/mcp?key=key%20with%20spaces");
  assert.equal(received[1].payload.method, "notifications/initialized");
  assert.equal(received[2].payload.method, "tools/list");
  assert.equal(manager.definitions()[0].function.name, "mcp__amap-maps__maps_geo");
  assert.equal(await manager.call("mcp__amap-maps__maps_geo", { address: "北京" }), "北京市朝阳区");
  assert.equal(received[3].session, "amap-session-1");
  manager.configureEnvironment({ AMAP_MAPS_API_KEY: "" });
  await manager.refresh();
  assert.equal(manager.status()[0].connected, false);
  assert.equal(manager.status()[0].tools, 0);
});

test("MCP manager reports a missing AMap key without exposing a resolved URL", async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-mcp-missing-"));
  await fs.writeFile(path.join(dataRoot, "mcp.json"), JSON.stringify({ servers: [{ name: "amap-maps", url: "https://mcp.amap.com/mcp?key={{AMAP_MAPS_API_KEY}}" }] }), "utf8");
  const manager = new McpManager(dataRoot, { environment: {} });
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));

  await manager.init();
  assert.match(manager.status()[0].error, /AMAP_MAPS_API_KEY/);
  assert.equal(manager.status()[0].tools, 0);
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

function json(res, payload) {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let value = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { value += chunk; });
    req.on("end", () => resolve(value));
    req.on("error", reject);
  });
}
