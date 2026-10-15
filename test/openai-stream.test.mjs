import test from "node:test";
import assert from "node:assert/strict";
import { readCompletionStream } from "../src/openai-stream.mjs";

test("OpenAI SSE parser streams text and assembles fragmented tool calls", async () => {
  const encoder = new TextEncoder();
  const frames = [
    { choices: [{ delta: { content: "Hello " } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "write_", arguments: '{"path":' } }] } }] },
    { choices: [{ delta: { content: "world", tool_calls: [{ index: 0, function: { name: "file", arguments: '"demo.py","content":"print(1)"}' } }] } }] }
  ];
  const stream = new ReadableStream({
    start(controller) {
      const payload = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n";
      controller.enqueue(encoder.encode(payload.slice(0, 29)));
      controller.enqueue(encoder.encode(payload.slice(29)));
      controller.close();
    }
  });
  const chunks = [];
  const result = await readCompletionStream(stream, (chunk) => chunks.push(chunk));
  assert.equal(result.content, "Hello world");
  assert.deepEqual(chunks, ["Hello ", "world"]);
  assert.deepEqual(result.toolCalls, [{ id: "call-1", name: "write_file", arguments: '{"path":"demo.py","content":"print(1)"}' }]);
});
