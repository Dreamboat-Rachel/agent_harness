import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MAX_MODELS = 50;

export class ModelRegistry {
  constructor(dataRoot, legacy = {}) {
    this.file = path.join(dataRoot, "models.json");
    this.legacy = legacy;
    this.data = { version: 1, defaultModelId: null, models: [] };
    this.saveQueue = Promise.resolve();
  }

  async init() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (Array.isArray(saved.models)) this.data = { version: 1, defaultModelId: saved.defaultModelId || null, models: saved.models };
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    if (!this.data.models.length && this.legacy.baseUrl && this.legacy.model) {
      const now = new Date().toISOString();
      const id = randomUUID();
      this.data.models.push({ id, name: this.legacy.model, provider: "OpenAI-compatible", baseUrl: this.legacy.baseUrl, model: this.legacy.model, apiKey: this.legacy.apiKey || "", enabled: true, supportsTools: true, supportsVision: false, temperature: null, maxOutputTokens: null, systemPrompt: "", createdAt: now, updatedAt: now });
      this.data.defaultModelId = id;
      await this.save();
    }
    this.ensureDefault();
    return this.list();
  }

  list() {
    return { defaultModelId: this.data.defaultModelId, models: this.data.models.map((model) => this.publicModel(model)) };
  }

  publicModel(model) {
    return { id: model.id, name: model.name, provider: model.provider, baseUrl: model.baseUrl, model: model.model, enabled: model.enabled !== false, supportsTools: model.supportsTools !== false, supportsVision: Boolean(model.supportsVision), temperature: model.temperature ?? null, maxOutputTokens: model.maxOutputTokens ?? null, systemPrompt: model.systemPrompt || "", apiKeyConfigured: Boolean(model.apiKey), isDefault: model.id === this.data.defaultModelId, createdAt: model.createdAt, updatedAt: model.updatedAt };
  }

  resolve(id) {
    const model = id ? this.data.models.find((entry) => entry.id === id) : this.data.models.find((entry) => entry.id === this.data.defaultModelId);
    if (!model) return null;
    if (model.enabled === false) throw new Error("所选模型已停用，请选择其他模型");
    return { ...model };
  }

  async create(input) {
    if (this.data.models.length >= MAX_MODELS) throw new Error(`最多可配置 ${MAX_MODELS} 个模型`);
    const now = new Date().toISOString();
    const model = normalizeModel(input, { id: randomUUID(), createdAt: now, updatedAt: now });
    this.data.models.push(model);
    if (!this.data.defaultModelId && model.enabled) this.data.defaultModelId = model.id;
    await this.save();
    return this.list();
  }

  async update(id, input) {
    const index = this.data.models.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error("模型不存在");
    const current = this.data.models[index];
    const apiKey = input.clearApiKey ? "" : input.apiKey ? String(input.apiKey).trim() : current.apiKey;
    const model = normalizeModel({ ...input, apiKey }, { ...current, updatedAt: new Date().toISOString() });
    this.data.models[index] = model;
    this.ensureDefault();
    await this.save();
    return this.list();
  }

  async remove(id) {
    const index = this.data.models.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error("模型不存在");
    this.data.models.splice(index, 1);
    this.ensureDefault();
    await this.save();
    return this.list();
  }

  async setDefault(id) {
    const model = this.data.models.find((entry) => entry.id === id);
    if (!model) throw new Error("模型不存在");
    if (model.enabled === false) throw new Error("请先启用该模型");
    this.data.defaultModelId = id;
    await this.save();
    return this.list();
  }

  ensureDefault() {
    const current = this.data.models.find((entry) => entry.id === this.data.defaultModelId && entry.enabled !== false);
    if (!current) this.data.defaultModelId = this.data.models.find((entry) => entry.enabled !== false)?.id || null;
  }

  async save() {
    const payload = `${JSON.stringify(this.data, null, 2)}\n`;
    this.saveQueue = this.saveQueue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporary, this.file);
    });
    return this.saveQueue;
  }
}

function normalizeModel(input, defaults) {
  const name = String(input.name ?? defaults.name ?? "").trim();
  const provider = String(input.provider ?? defaults.provider ?? "OpenAI-compatible").trim();
  const baseUrl = String(input.baseUrl ?? defaults.baseUrl ?? "").trim().replace(/\/$/, "");
  const model = String(input.model ?? defaults.model ?? "").trim();
  if (!name || !baseUrl || !model) throw new Error("名称、接口地址和模型 ID 不能为空");
  if (name.length > 80 || provider.length > 80 || model.length > 160) throw new Error("模型配置文字过长");
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error("接口地址必须是有效的 HTTP 或 HTTPS URL"); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("接口地址必须使用 HTTP 或 HTTPS");
  const temperature = optionalNumber(input.temperature ?? defaults.temperature, 0, 2, "温度");
  const maxOutputTokens = optionalInteger(input.maxOutputTokens ?? defaults.maxOutputTokens, 1, 1000000, "最大输出 tokens");
  return { ...defaults, name, provider, baseUrl, model, apiKey: String(input.apiKey ?? defaults.apiKey ?? "").trim(), enabled: input.enabled ?? defaults.enabled ?? true, supportsTools: input.supportsTools ?? defaults.supportsTools ?? true, supportsVision: input.supportsVision ?? defaults.supportsVision ?? false, temperature, maxOutputTokens, systemPrompt: String(input.systemPrompt ?? defaults.systemPrompt ?? "").slice(0, 20000) };
}

function optionalNumber(value, min, max, label) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label}必须在 ${min} 到 ${max} 之间`);
  return number;
}

function optionalInteger(value, min, max, label) {
  const number = optionalNumber(value, min, max, label);
  if (number != null && !Number.isInteger(number)) throw new Error(`${label}必须是整数`);
  return number;
}
