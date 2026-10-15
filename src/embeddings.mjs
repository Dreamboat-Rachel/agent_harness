import { createHash } from "node:crypto";

export class EmbeddingClient {
  constructor(config = {}) {
    this.lastError = "";
    this.configure({
      ...config,
      embeddingBaseUrl: process.env.EMBEDDING_BASE_URL || config.embeddingBaseUrl || "",
      embeddingApiKey: process.env.EMBEDDING_API_KEY || process.env.DASHSCOPE_API_KEY || config.embeddingApiKey || "",
      embeddingModel: process.env.EMBEDDING_MODEL || config.embeddingModel || "",
      embeddingDimensions: process.env.EMBEDDING_DIMENSIONS || config.embeddingDimensions || "",
      embeddingFormat: process.env.EMBEDDING_API_FORMAT || config.embeddingFormat || "auto"
    });
  }

  configure(config = {}) {
    this.baseUrl = String(config.embeddingBaseUrl || config.baseUrl || "").replace(/\/$/, "");
    this.apiKey = String(config.embeddingApiKey || config.apiKey || "");
    this.model = String(config.embeddingModel || "");
    this.dimensions = positiveInteger(config.embeddingDimensions);
    this.format = normalizeFormat(config.embeddingFormat);
    this.lastError = "";
  }

  get configured() { return Boolean(this.baseUrl && this.model); }
  get resolvedFormat() { return this.format === "auto" ? detectFormat(this.baseUrl) : this.format; }
  get endpoint() { return embeddingEndpoint(this.baseUrl, this.resolvedFormat); }
  get indexKey() { return createHash("sha256").update(JSON.stringify([this.endpoint, this.resolvedFormat, this.model, this.dimensions])).digest("hex"); }

  status() {
    return {
      configured: this.configured,
      mode: this.configured ? (this.lastError ? "degraded" : "vector") : "lexical-fallback",
      model: this.model || "",
      format: this.resolvedFormat,
      lastError: this.lastError
    };
  }

  async embed(inputs, signal, { textType = "document" } = {}) {
    if (!this.configured) throw new Error("embedding model is not configured");
    const values = Array.isArray(inputs) ? inputs.map(String) : [String(inputs)];
    if (!values.length) return [];
    const format = this.resolvedFormat;
    const body = requestBody(format, this.model, values, this.dimensions, textType);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
        headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify(body)
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`embedding request failed: HTTP ${response.status}`); }
      const payload = await response.json();
      const rows = responseRows(format, payload);
      if (rows.length !== values.length) throw new Error(`embedding response count mismatch: expected ${values.length}, received ${rows.length}`);
      const vectors = rows.map((row) => normalizeVector(row.embedding));
      const dimensions = vectors[0]?.length || 0;
      if (!dimensions || vectors.some((vector) => vector.length !== dimensions)) throw new Error("embedding response contained invalid vector dimensions");
      this.lastError = "";
      return vectors;
    } catch (error) {
      this.lastError = String(error?.message || error).slice(0, 500);
      throw error;
    }
  }
}

function requestBody(format, model, values, dimensions, textType) {
  if (format === "dashscope") {
    const parameters = { text_type: textType === "query" ? "query" : "document", output_type: "dense" };
    if (dimensions) parameters.dimension = dimensions;
    return { model, input: { texts: values }, parameters };
  }
  const body = { model, input: values };
  if (dimensions) body.dimensions = dimensions;
  return body;
}

function responseRows(format, payload) {
  const rows = format === "dashscope" ? payload?.output?.embeddings : payload?.data;
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => rowIndex(left) - rowIndex(right));
}

function rowIndex(row) {
  const value = row?.index ?? row?.text_index ?? row?.textIndex ?? 0;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function normalizeFormat(value) {
  const format = String(value || "auto").trim().toLocaleLowerCase();
  return ["auto", "openai", "dashscope"].includes(format) ? format : "auto";
}

function detectFormat(url) {
  const value = String(url || "").toLocaleLowerCase();
  return value.includes("/services/embeddings/") || value.includes("dashscope") || value.includes("qianwenaiapi") ? "dashscope" : "openai";
}

function embeddingEndpoint(baseUrl, format) {
  const value = String(baseUrl || "").replace(/\/$/, "");
  if (!value) return "";
  if (format === "dashscope" || /\/embeddings$/i.test(value) || /\/text-embedding$/i.test(value)) return value;
  return `${value}/embeddings`;
}

function normalizeVector(value) {
  if (!Array.isArray(value) || !value.length) throw new Error("embedding response did not contain a vector");
  const vector = value.map(Number);
  if (vector.some((item) => !Number.isFinite(item))) throw new Error("embedding vector contains a non-finite value");
  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  if (!magnitude) throw new Error("embedding vector has zero magnitude");
  return vector.map((item) => item / magnitude);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return -1;
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
  return Math.max(-1, Math.min(1, score));
}
