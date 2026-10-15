import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { autoApproveTool, loadEnvFile, publicModelConfig, saveModelConfig } from "../src/model-config.mjs";

test("model configuration persists safely and never exposes the API key", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-env-"));
  const envPath = path.join(directory, ".env");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await fs.writeFile(envPath, "# keep this comment\nOTHER_SETTING=preserved\n", "utf8");
  const saved = await saveModelConfig(envPath, { baseUrl: "https://provider.example/v1/", model: "chat-model", apiKey: "key-\"value", bochaApiKey: "bocha-secret" });
  assert.equal(saved.baseUrl, "https://provider.example/v1");
  assert.equal(saved.apiKeyConfigured, true);
  const publicConfig = await publicModelConfig(envPath);
  assert.deepEqual(publicConfig, { baseUrl: "https://provider.example/v1", model: "chat-model", embeddingBaseUrl: "", embeddingModel: "", embeddingDimensions: "", embeddingFormat: "auto", embeddingApiKeyConfigured: true, embeddingApiKeySeparateConfigured: false, amapApiKeyConfigured: false, bochaApiKeyConfigured: true, policy: "always-ask", apiKeyConfigured: true });
  assert.equal(JSON.stringify(publicConfig).includes("key-"), false);
  assert.equal(JSON.stringify(publicConfig).includes("bocha-secret"), false);

  const retained = await saveModelConfig(envPath, { baseUrl: "https://provider.example/v1", model: "chat-model-2", apiKey: "" }, saved);
  assert.equal(retained.apiKey, "key-\"value");
  const environment = {};
  await loadEnvFile(envPath, environment);
  assert.deepEqual(environment, { OTHER_SETTING: "preserved", LLM_BASE_URL: "https://provider.example/v1", LLM_API_KEY: "key-\"value", LLM_MODEL: "chat-model-2", EMBEDDING_BASE_URL: "", EMBEDDING_API_KEY: "", EMBEDDING_MODEL: "", EMBEDDING_DIMENSIONS: "", EMBEDDING_API_FORMAT: "auto", AMAP_MAPS_API_KEY: "", BOCHA_API_KEY: "bocha-secret", TOOL_POLICY: "always-ask" });

  const cleared = await saveModelConfig(envPath, { baseUrl: "https://provider.example/v1", model: "chat-model-2", clearApiKey: true }, retained);
  assert.equal(cleared.apiKeyConfigured, false);
});

test("workspace-write policy skips workspace file approvals but keeps command execution gated", () => {
  assert.equal(autoApproveTool("workspace-write", "write_file", "w"), true);
  assert.equal(autoApproveTool("workspace-write", "read_file", "r"), true);
  assert.equal(autoApproveTool("workspace-write", "run_command", "w"), false);
  assert.equal(autoApproveTool("workspace-write", "mcp__server__write", "w"), false);
  assert.equal(autoApproveTool("always-ask", "write_file", "w"), false);
});

test("model configuration rejects invalid URLs", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-env-invalid-"));
  const envPath = path.join(directory, ".env");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await assert.rejects(saveModelConfig(envPath, { baseUrl: "file:///tmp/key", model: "model" }), /HTTP 或 HTTPS/);
  await assert.rejects(saveModelConfig(envPath, { baseUrl: "", model: "model" }), /不能为空/);
});
