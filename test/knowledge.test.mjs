import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { KnowledgeBase } from "../src/knowledge.mjs";

test("KnowledgeBase persists memory and validates skill names", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-knowledge-"));
  const knowledge = new KnowledgeBase(root);
  await knowledge.init();
  assert.match(await knowledge.memory(), /Durable user preferences/);
  await knowledge.writeMemory("# Memory\n\nPrefer concise answers.");
  assert.equal(await knowledge.memory(), "# Memory\n\nPrefer concise answers.\n");
  assert.equal((await knowledge.listSkills())[0].name, "workspace-basics");
  await assert.rejects(() => knowledge.readSkill("../outside"), /invalid skill name/);
  await fs.rm(root, { recursive: true, force: true });
});
