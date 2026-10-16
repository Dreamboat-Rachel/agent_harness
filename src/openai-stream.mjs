import { randomUUID } from "node:crypto";

export async function readCompletionStream(stream, onToken) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const toolCalls = new Map();
  let content = "";
  let model = null;
  let buffer = "";
  const consume = (line) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const response = JSON.parse(data);
    if (typeof response.model === "string" && response.model) model = response.model;
    const chunk = response.choices?.[0]?.delta || {};
    const text = typeof chunk.content === "string" ? chunk.content : Array.isArray(chunk.content) ? chunk.content.map((part) => part.text || "").join("") : "";
    if (text) { content += text; onToken(text); }
    for (const part of chunk.tool_calls || []) {
      const index = part.index ?? toolCalls.size;
      const call = toolCalls.get(index) || { id: "", name: "", arguments: "" };
      if (part.id) call.id = part.id;
      if (part.function?.name) call.name += part.function.name;
      if (part.function?.arguments) call.arguments += part.function.arguments;
      toolCalls.set(index, call);
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  return {
    content,
    model,
    toolCalls: [...toolCalls.values()].map((call) => ({ id: call.id || randomUUID(), name: call.name, arguments: call.arguments || "{}" }))
  };
}
