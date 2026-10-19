import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { cosineSimilarity } from "./embeddings.mjs";

const ALLOWED_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml", ".html", ".htm", ".log", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".java", ".c", ".cpp", ".h", ".cs", ".go", ".rs", ".sh", ".sql", ".css", ".ini", ".toml"]);
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 10;

export class KnowledgeLibrary {
  constructor(dataRoot, { embedder } = {}) {
    this.directory = path.join(dataRoot, "knowledge-library");
    this.file = path.join(this.directory, "library.json");
    this.embedder = embedder;
    this.data = { documents: [] };
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    try { this.data = normalizeData(JSON.parse(await fs.readFile(this.file, "utf8"))); }
    catch (error) {
      if (error.code !== "ENOENT") throw new Error(`知识库索引无法读取：${error.message}`);
      await this.#save();
    }
  }

  list() {
    return this.data.documents.map(({ id, name, size, createdAt, updatedAt, chunks, graphStatus }) => ({ id, name, size, createdAt, updatedAt, chunkCount: chunks.length, graphStatus }));
  }

  get(id) {
    const document = this.data.documents.find((entry) => entry.id === id);
    if (!document) return null;
    return { ...this.#summary(document), content: document.content };
  }

  async add(files) {
    if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) throw inputError(`一次最多添加 ${MAX_FILES} 个文件`);
    let total = 0;
    const prepared = files.map((file) => {
      const name = String(file?.name || "").replace(/\\/g, "/").split("/").pop().slice(0, 180);
      const extension = path.extname(name).toLocaleLowerCase();
      const content = String(file?.content || "").replace(/\r\n?/g, "\n");
      const size = Buffer.byteLength(content, "utf8");
      total += size;
      if (!name || !ALLOWED_EXTENSIONS.has(extension)) throw inputError(`不支持“${name || "未命名文件"}”格式，请使用文本、Markdown、代码、JSON 或 CSV 文件`);
      if (!content.trim()) throw inputError(`“${name}”没有可读取的文本内容`);
      if (size > MAX_FILE_BYTES) throw Object.assign(inputError(`“${name}”超过单文件 3 MB 限制`), { statusCode: 413 });
      return { name, content, size, hash: createHash("sha256").update(content).digest("hex") };
    });
    if (total > MAX_TOTAL_BYTES) throw Object.assign(inputError("本次上传总大小不能超过 12 MB"), { statusCode: 413 });
    const created = [];
    for (const item of prepared) {
      const duplicate = this.data.documents.find((document) => document.hash === item.hash);
      if (duplicate) { created.push({ ...this.#summary(duplicate), duplicate: true }); continue; }
      const now = new Date().toISOString();
      const document = {
        id: randomUUID(), ...item, createdAt: now, updatedAt: now, graphStatus: "not-extracted",
        chunks: splitText(item.content).map((text, index) => ({ id: `${index + 1}`, index, text, vector: null }))
      };
      this.data.documents.unshift(document);
      created.push(this.#summary(document));
      try { await this.#index(document); } catch { /* Lexical retrieval remains available when vector indexing fails. */ }
    }
    await this.#save();
    return created;
  }

  async remove(id) {
    const before = this.data.documents.length;
    this.data.documents = this.data.documents.filter((document) => document.id !== id);
    if (this.data.documents.length === before) return false;
    await this.#save();
    return true;
  }

  async search(query, { limit = 5, excludeId = "" } = {}) {
    const normalizedQuery = String(query || "").trim().slice(0, 4000);
    if (!normalizedQuery) return [];
    let queryVector = null;
    if (this.embedder?.configured) {
      try { [queryVector] = await this.embedder.embed([normalizedQuery], undefined, { textType: "query" }); }
      catch { queryVector = null; }
    }
    const tokens = tokenize(normalizedQuery);
    const matches = [];
    for (const document of this.data.documents) {
      if (document.id === excludeId) continue;
      for (const chunk of document.chunks) {
        const lower = chunk.text.toLocaleLowerCase();
        const hits = tokens.filter((token) => lower.includes(token)).length;
        const lexical = tokens.length ? hits / tokens.length : 0;
        const vector = queryVector && chunk.vector?.key === this.embedder.indexKey ? cosineSimilarity(queryVector, chunk.vector.value) : -1;
        const score = vector >= 0 ? vector * 0.72 + lexical * 0.28 : lexical;
        if (score >= 0.12) matches.push({ documentId: document.id, name: document.name, chunk: chunk.index + 1, text: chunk.text, score: Number(score.toFixed(4)), retrieval: vector >= 0 ? "vector" : "lexical" });
      }
    }
    return matches.sort((left, right) => right.score - left.score).slice(0, Math.max(1, Math.min(Number(limit) || 5, 12)));
  }

  async setGraphStatus(id, status) {
    const document = this.data.documents.find((entry) => entry.id === id);
    if (!document) return false;
    document.graphStatus = status;
    document.updatedAt = new Date().toISOString();
    await this.#save();
    return true;
  }

  #summary(document) {
    return { id: document.id, name: document.name, size: document.size, createdAt: document.createdAt, updatedAt: document.updatedAt, chunkCount: document.chunks.length, graphStatus: document.graphStatus };
  }

  async #index(document) {
    if (!this.embedder?.configured) return;
    for (let offset = 0; offset < document.chunks.length; offset += 16) {
      const batch = document.chunks.slice(offset, offset + 16);
      const vectors = await this.embedder.embed(batch.map((chunk) => chunk.text), undefined, { textType: "document" });
      batch.forEach((chunk, index) => { chunk.vector = { key: this.embedder.indexKey, value: vectors[index] }; });
    }
  }

  async #save() {
    const staging = `${this.file}.tmp`;
    await fs.writeFile(staging, JSON.stringify(this.data), "utf8");
    await fs.rename(staging, this.file);
  }
}

function normalizeData(value) {
  return { documents: Array.isArray(value?.documents) ? value.documents.filter((document) => document && typeof document.content === "string" && Array.isArray(document.chunks)) : [] };
}

function splitText(content) {
  const normalized = String(content).trim();
  const chunks = [];
  const max = 1100;
  const overlap = 140;
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + max, normalized.length);
    if (end < normalized.length) {
      const boundary = Math.max(normalized.lastIndexOf("\n", end), normalized.lastIndexOf("。", end), normalized.lastIndexOf(".", end), normalized.lastIndexOf(";", end));
      if (boundary > start + max * 0.55) end = boundary + 1;
    }
    const text = normalized.slice(start, end).trim();
    if (text) chunks.push(text);
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function tokenize(value) {
  const normalized = String(value || "").toLocaleLowerCase();
  const words = normalized.match(/[a-z\d_'-]{2,}/g) || [];
  const hanRuns = normalized.match(/[\u3400-\u9fff]+/g) || [];
  const hanTokens = hanRuns.flatMap((run) => {
    const characters = [...run];
    return characters.length < 2 ? characters : characters.slice(0, -1).map((character, index) => character + characters[index + 1]);
  });
  return [...new Set([...words, ...hanTokens])].slice(0, 60);
}

function inputError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}
