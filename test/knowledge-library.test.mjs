import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { KnowledgeLibrary } from "../src/knowledge-library.mjs";

test("knowledge library stores documents per project and searches Chinese text", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-harness-library-"));
  try {
    const first = new KnowledgeLibrary(path.join(root, "project-a"));
    const second = new KnowledgeLibrary(path.join(root, "project-b"));
    await first.init();
    await second.init();
    const [document] = await first.add([{ name: "架构说明.md", content: "项目运行时按项目隔离模型、工具和知识库。会话检索项目知识。" }]);
    assert.equal(document.name, "架构说明.md");
    assert.equal(first.get(document.id).content.includes("按项目隔离"), true);
    assert.equal((await first.search("项目知识库"))[0].name, "架构说明.md");
    assert.deepEqual(second.list(), []);
    assert.equal(await first.remove(document.id), true);
    assert.deepEqual(await first.search("项目知识库"), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("knowledge library rejects unsupported, empty, and oversized files and detects duplicates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-harness-library-"));
  try {
    const library = new KnowledgeLibrary(root);
    await library.init();
    await assert.rejects(library.add([{ name: "notes.pdf", content: "not parsed" }]), /不支持/);
    await assert.rejects(library.add([{ name: "empty.txt", content: "  " }]), /没有可读取/);
    await assert.rejects(library.add([{ name: "large.txt", content: "x".repeat(3 * 1024 * 1024 + 1) }]), /3 MB/);
    const [first] = await library.add([{ name: "one.txt", content: "same content" }]);
    const [duplicate] = await library.add([{ name: "two.txt", content: "same content" }]);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.id, first.id);
    assert.equal(library.list().length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
