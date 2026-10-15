import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, hydrateSessions } from "../src/store.mjs";

test("Store imports legacy traces and restores persisted history", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-store-"));
  const traces = path.join(root, "traces");
  await fs.mkdir(traces, { recursive: true });
  const user = { id: "m1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00.000Z" };
  const assistant = { id: "m2", role: "assistant", content: "world", createdAt: "2026-01-01T00:00:01.000Z" };
  await fs.writeFile(path.join(traces, "legacy.jsonl"), [
    JSON.stringify({ ts: user.createdAt, type: "message", payload: user }),
    JSON.stringify({ ts: assistant.createdAt, type: "message", payload: assistant })
  ].join("\n") + "\n");

  let store = new Store(root);
  await store.importLegacyTraces(traces);
  assert.equal(store.sessionRows().length, 1);
  assert.equal(store.messageRows("legacy").length, 2);
  store.close();

  store = new Store(root);
  const sessions = hydrateSessions(store, () => ({ publish() {}, subscribe() {} }), traces);
  assert.equal(sessions.get("legacy").history[1].content, "world");
  assert.equal(sessions.get("legacy").messages[0].content, "hello");
  store.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("Store persists schedules and subagent results", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-store-"));
  const store = new Store(root);
  const session = { id: "s1", title: "test", status: "idle", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [], summary: "" };
  store.insertSession(session);
  const now = new Date().toISOString();
  store.insertSubagent({ id: "a1", parentSessionId: "s1", status: "running", prompt: "inspect", result: "", createdAt: now, updatedAt: now });
  store.updateSubagent({ id: "a1", status: "completed", result: "done", updatedAt: now });
  store.insertSchedule({ id: "j1", name: "job", prompt: "work", intervalMinutes: 5, sessionId: "s1", enabled: true, nextRunAt: now, lastRunAt: null, createdAt: now });
  assert.equal(store.subagents("s1")[0].result, "done");
  assert.equal(store.schedules()[0].enabled, true);
  assert.equal(store.deleteSchedule("j1"), true);
  store.close();
  await fs.rm(root, { recursive: true, force: true });
});
