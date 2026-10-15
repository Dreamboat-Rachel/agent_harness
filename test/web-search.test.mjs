import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { BochaSearchClient } from "../src/web-search.mjs";

test("Bocha search sends the documented request and returns compact source results", async (t) => {
  let observed;
  const server = http.createServer(async (req, res) => {
    observed = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(await body(req)) };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ code: 200, data: { webPages: { totalEstimatedMatches: 42, value: [{ name: "阿里巴巴 ESG 报告", url: "https://example.com/esg", siteName: "example.com", snippet: "2024 报告", summary: "报告摘要", datePublished: "2024-07-01" }] } } }));
  });
  const endpoint = await listen(server);
  t.after(() => server.close());

  const client = new BochaSearchClient({ bochaSearchUrl: `${endpoint}/v1/web-search`, bochaApiKey: "bocha-secret" });
  const result = await client.search({ query: "阿里巴巴2024年的ESG报告", summary: true, freshness: "noLimit", count: 10 });

  assert.equal(observed.url, "/v1/web-search");
  assert.equal(observed.authorization, "Bearer bocha-secret");
  assert.deepEqual(observed.body, { query: "阿里巴巴2024年的ESG报告", summary: true, freshness: "noLimit", count: 10 });
  assert.deepEqual(result, { query: "阿里巴巴2024年的ESG报告", totalEstimatedMatches: 42, results: [{ title: "阿里巴巴 ESG 报告", url: "https://example.com/esg", siteName: "example.com", snippet: "2024 报告", summary: "报告摘要", datePublished: "2024-07-01" }] });
});

test("Bocha search requires a key and does not expose it in errors", async () => {
  const client = new BochaSearchClient({ bochaApiKey: "" });
  await assert.rejects(client.search({ query: "test" }), /BOCHA_API_KEY/);
  assert.equal(JSON.stringify(client.status()).includes("secret"), false);
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
