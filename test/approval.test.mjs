import test from "node:test";
import assert from "node:assert/strict";
import { reviewApproval } from "../src/approval.mjs";

test("assistant review escalates missing model, invalid responses, and failures to manual approval", async () => {
  const input = { request: "整理文件", call: { name: "run_command", arguments: { command: "ls" } } };
  assert.equal((await reviewApproval({ ...input, configured: false })).decision, "ask");
  for (const content of ["approved!", '{"decision":"allow"}', '{"decision":"maybe","reason":"?"}']) {
    assert.equal((await reviewApproval({ ...input, configured: true, complete: async () => ({ content }) })).decision, "ask");
  }
  assert.equal((await reviewApproval({ ...input, configured: true, complete: async () => { throw new Error("offline"); } })).decision, "ask");
});

test("assistant reviewer honors allow, deny, and ask without tool access", async () => {
  for (const decision of ["allow", "deny", "ask"]) {
    const result = await reviewApproval({ configured: true, request: "查询天气", call: { name: "maps_weather", arguments: { city: "北京" } }, complete: async (messages, signal, options) => {
      assert.deepEqual(options.tools, []);
      assert.equal(JSON.parse(messages[0].content).request, "查询天气");
      return { content: JSON.stringify({ decision, reason: "审批理由" }) };
    } });
    assert.equal(result.decision, decision);
  }
});
