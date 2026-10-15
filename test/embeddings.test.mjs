import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EmbeddingClient } from "../src/embeddings.mjs";

test("DashScope embedding uses the exact endpoint and input.texts schema", async (t) => {
  let observed;
  const server = http.createServer(async (req, res) => {
    observed = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(await body(req)) };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ output: { embeddings: [
      { text_index: 1, embedding: [0, 2, 0] },
      { text_index: 0, embedding: [3, 0, 0] }
    ] } }));
  });
  const base = await listen(server);
  t.after(() => server.close());

  const client = new EmbeddingClient({
    embeddingBaseUrl: `${base}/api/v1/services/embeddings/text-embedding/text-embedding`,
    embeddingApiKey: "dashscope-key",
    embeddingModel: "qwen3.7-text-embedding-flash",
    embeddingDimensions: "1024",
    embeddingFormat: "dashscope"
  });
  const vectors = await client.embed(["第一条", "第二条"], undefined, { textType: "query" });

  assert.equal(observed.url, "/api/v1/services/embeddings/text-embedding/text-embedding");
  assert.equal(observed.authorization, "Bearer dashscope-key");
  assert.deepEqual(observed.body, {
    model: "qwen3.7-text-embedding-flash",
    input: { texts: ["第一条", "第二条"] },
    parameters: { text_type: "query", output_type: "dense", dimension: 1024 }
  });
  assert.deepEqual(vectors, [[1, 0, 0], [0, 1, 0]]);
  assert.equal(client.status().format, "dashscope");
});

test("embedding format auto-detects DashScope and preserves OpenAI compatibility", async (t) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push({ url: req.url, body: JSON.parse(await body(req)) });
    res.setHeader("content-type", "application/json");
    if (req.url.includes("services/embeddings")) res.end(JSON.stringify({ output: { embeddings: [{ text_index: 0, embedding: [1, 0] }] } }));
    else res.end(JSON.stringify({ data: [{ index: 0, embedding: [0, 4] }] }));
  });
  const base = await listen(server);
  t.after(() => server.close());

  const dashscope = new EmbeddingClient({ embeddingBaseUrl: `${base}/api/v1/services/embeddings/text-embedding/text-embedding`, embeddingModel: "qwen", embeddingFormat: "auto" });
  const openai = new EmbeddingClient({ embeddingBaseUrl: `${base}/v1`, embeddingModel: "openai-model", embeddingFormat: "openai" });
  await dashscope.embed(["文档"], undefined, { textType: "document" });
  await openai.embed(["document"]);

  assert.equal(requests[0].url, "/api/v1/services/embeddings/text-embedding/text-embedding");
  assert.deepEqual(requests[0].body.input, { texts: ["文档"] });
  assert.equal(requests[0].body.parameters.text_type, "document");
  assert.equal(requests[1].url, "/v1/embeddings");
  assert.deepEqual(requests[1].body, { model: "openai-model", input: ["document"] });
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
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
