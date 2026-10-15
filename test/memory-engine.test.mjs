import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryEngine, deterministicExtraction } from "../src/memory-engine.mjs";
import { Store } from "../src/store.mjs";

test("LangGraph memory learns, deduplicates, recalls and builds a knowledge graph", async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-memory-"));
  const store = new Store(dataRoot);
  const memory = new MemoryEngine(store);
  t.after(async () => {
    store.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  });

  const extracted = deterministicExtraction("我喜欢简洁回答。Atlas 项目使用 LangGraph。");
  assert.ok(extracted.facts.some((fact) => fact.kind === "preference" && fact.object === "简洁回答"));
  assert.ok(extracted.relations.some((relation) => relation.predicate === "uses"));

  const first = await memory.rememberFact({
    kind: "preference", subject: "user", predicate: "prefers", object: "简洁回答", content: "用户喜欢简洁回答"
  });
  const second = await memory.rememberFact({
    kind: "preference", subject: "user", predicate: "prefers", object: "简洁回答", content: "用户喜欢简洁回答"
  });
  assert.equal(first.facts[0].created, true);
  assert.equal(second.facts[0].created, false);
  assert.deepEqual(store.memoryStats(), { facts: 1, entities: 2, relations: 1, events: 2 });

  const recalled = await memory.recall("回答要简洁", { limit: 5 });
  assert.equal(recalled.facts[0].content, "用户喜欢简洁回答");
  assert.match(recalled.context, /Relevant semantic memories/);
  assert.match(recalled.context, /Related knowledge graph/);

  const graph = memory.graph("简洁", 20);
  assert.ok(graph.entities.some((entity) => entity.name === "简洁回答"));
  assert.ok(graph.relations.some((relation) => relation.predicate === "prefers"));
  await memory.rememberFact({ kind: "preference", subject: "user", predicate: "prefers", object: "简洁回答", content: "用户希望回答简短一些" });
  assert.equal(store.memoryStats().facts, 1, "changing prose must not duplicate the same triple");
  assert.equal(store.memoryStats().relations, 1);
  store.deleteMemoryFact(first.facts[0].id);
  assert.equal(memory.graph().relations.length, 0);
  assert.equal(memory.graph().entities.length, 0);
});

test("automatic learning excludes unsupported and low-confidence graph relations", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-memory-filter-"));
  const store = new Store(root);
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const memory = new MemoryEngine(store, { extractor: async () => ({ facts: [{ subject: "user", predicate: "prefers", object: "中文", content: "可能偏好中文", confidence: 0.4 }], relations: [{ source: "assistant", predicate: "explains", target: "示例代码", confidence: 1 }] }) });
  await memory.learn({ text: "帮我查询北京天气" });
  assert.equal(store.memoryStats().facts, 0);
  assert.equal(store.memoryStats().relations, 0);
  const mismatched = new MemoryEngine(store, { extractor: async () => ({
    facts: [{ subject: "user", predicate: "avoids", object: "咖啡", content: "用户不喝咖啡", confidence: 0.95 }],
    relations: [{ source: "user", predicate: "prefers", target: "咖啡", confidence: 0.95 }]
  }) });
  await mismatched.learn({ text: "我不喝咖啡" });
  assert.equal(store.memoryStats().facts, 1);
  assert.equal(store.memoryStats().relations, 0, "sharing endpoints does not prove a different predicate");
  const fallback = deterministicExtraction('```\n记住 示例记忆\n```\n帮我使用地图查路线');
  assert.equal(fallback.facts.length, 0);
});

test("memory rejects credentials and does not count passive listings as access", async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-memory-safe-"));
  const store = new Store(dataRoot);
  const memory = new MemoryEngine(store);
  t.after(async () => {
    store.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  });

  const rejected = await memory.rememberFact({ content: "API key: sk-1234567890abcdefghijklmnop" });
  assert.equal(rejected.facts.length, 0);
  assert.equal(rejected.relations.length, 0);
  assert.equal(store.memoryStats().facts, 0);

  await memory.rememberFact({ content: "用户使用中文", subject: "user", predicate: "uses", object: "中文" });
  await memory.search("", 20);
  assert.equal(store.memoryFacts()[0].accessCount, 0);
  await memory.search("中文", 20);
  assert.equal(store.memoryFacts()[0].accessCount, 1);
});

test("memory persists embeddings and recalls semantic matches without shared words", async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-memory-vector-"));
  const store = new Store(dataRoot);
  const embedder = {
    configured: true,
    model: "test-embedding",
    status: () => ({ configured: true, mode: "vector", model: "test-embedding", lastError: "" }),
    async embed(inputs) {
      return inputs.map((text) => String(text).includes("居家") || String(text).includes("远程") ? [1, 0, 0] : [0, 1, 0]);
    }
  };
  const memory = new MemoryEngine(store, { embedder });
  t.after(async () => { store.close(); await fs.rm(dataRoot, { recursive: true, force: true }); });

  await memory.rememberFact({ content: "用户每周三居家处理工作", subject: "user", predicate: "schedule", object: "周三居家" });
  await memory.rememberFact({ content: "Atlas 使用 PostgreSQL", subject: "Atlas", predicate: "uses", object: "PostgreSQL" });
  const recalled = await memory.recall("哪天远程办公", { limit: 1 });

  assert.equal(recalled.facts[0].content, "用户每周三居家处理工作");
  assert.equal(recalled.facts[0].retrieval, "vector");
  assert.equal(store.memoryEmbeddings("test-embedding").length, 2);
});
