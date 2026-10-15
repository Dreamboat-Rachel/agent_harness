import test from "node:test";
import assert from "node:assert/strict";
import { compactionCutoff } from "../src/runtime-utils.mjs";

test("compaction keeps assistant tool calls with every matching output", () => {
  const history = [
    { role: "user", content: "old" },
    { role: "assistant", content: "old reply" },
    { role: "user", content: "use tools" },
    { role: "assistant", content: null, tool_calls: [{ id: "a" }, { id: "b" }] },
    { role: "tool", tool_call_id: "a", content: "one" },
    { role: "tool", tool_call_id: "b", content: "two" },
    { role: "assistant", content: "done" }
  ];
  const cutoff = compactionCutoff(history, 2);
  assert.equal(cutoff, 3);
  assert.deepEqual(history.slice(cutoff).map((entry) => entry.role), ["assistant", "tool", "tool", "assistant"]);
});
