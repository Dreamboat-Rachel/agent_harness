import { promises as fs } from "node:fs";

const MODEL_KEYS = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "EMBEDDING_BASE_URL", "EMBEDDING_API_KEY", "EMBEDDING_MODEL", "EMBEDDING_DIMENSIONS", "EMBEDDING_API_FORMAT", "AMAP_MAPS_API_KEY", "BOCHA_API_KEY", "TOOL_POLICY"];
const TOOL_POLICIES = ["always-ask", "assistant-approve", "workspace-write", "read-only", "deny-all", "allow-all"];
const EMBEDDING_FORMATS = ["auto", "openai", "dashscope"];

export async function loadEnvFile(filePath, target = process.env) {
  let content;
  try { content = await fs.readFile(filePath, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
  const values = parseEnv(content);
  for (const [key, value] of Object.entries(values)) if (target[key] === undefined) target[key] = value;
  return values;
}

export async function saveModelConfig(filePath, input, current = {}, { requireModel = true } = {}) {
  const baseUrl = String(input.baseUrl ?? current.baseUrl ?? "").trim().replace(/\/$/, "");
  const model = String(input.model ?? current.model ?? "").trim();
  const embeddingBaseUrl = String(input.embeddingBaseUrl ?? current.embeddingBaseUrl ?? "").trim().replace(/\/$/, "");
  const embeddingModel = String(input.embeddingModel ?? current.embeddingModel ?? "").trim();
  const embeddingDimensions = normalizeDimensions(input.embeddingDimensions ?? current.embeddingDimensions ?? "");
  const embeddingFormat = String(input.embeddingFormat ?? current.embeddingFormat ?? "auto").trim().toLocaleLowerCase();
  const policy = String(input.policy ?? current.policy ?? "always-ask").trim();
  if (requireModel && (!baseUrl || !model)) throw new Error("接口地址和模型名称不能为空");
  if (baseUrl) {
    let parsed;
    try { parsed = new URL(baseUrl); }
    catch { throw new Error("接口地址必须是有效的 HTTP 或 HTTPS URL"); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("接口地址必须使用 HTTP 或 HTTPS");
  }
  if (embeddingBaseUrl) {
    let embeddingUrl;
    try { embeddingUrl = new URL(embeddingBaseUrl); }
    catch { throw new Error("向量接口地址必须是有效的 HTTP 或 HTTPS URL"); }
    if (!["http:", "https:"].includes(embeddingUrl.protocol)) throw new Error("向量接口地址必须使用 HTTP 或 HTTPS");
  }
  if (!TOOL_POLICIES.includes(policy)) throw new Error("工具权限模式无效");
  if (!EMBEDDING_FORMATS.includes(embeddingFormat)) throw new Error("向量接口格式无效");

  const previous = await readEnv(filePath);
  const apiKey = input.clearApiKey ? "" : input.apiKey ? String(input.apiKey).trim() : String(current.apiKey ?? previous.LLM_API_KEY ?? "");
  const embeddingApiKey = input.clearEmbeddingApiKey ? "" : input.embeddingApiKey ? String(input.embeddingApiKey).trim() : String(current.embeddingApiKey ?? previous.EMBEDDING_API_KEY ?? "");
  const amapApiKey = input.clearAmapApiKey ? "" : input.amapApiKey ? String(input.amapApiKey).trim() : String(current.amapApiKey ?? previous.AMAP_MAPS_API_KEY ?? "");
  const bochaApiKey = input.clearBochaApiKey ? "" : input.bochaApiKey ? String(input.bochaApiKey).trim() : String(current.bochaApiKey ?? previous.BOCHA_API_KEY ?? "");
  const values = { ...previous, LLM_BASE_URL: baseUrl, LLM_API_KEY: apiKey, LLM_MODEL: model, EMBEDDING_BASE_URL: embeddingBaseUrl, EMBEDDING_API_KEY: embeddingApiKey, EMBEDDING_MODEL: embeddingModel, EMBEDDING_DIMENSIONS: embeddingDimensions, EMBEDDING_API_FORMAT: embeddingFormat, AMAP_MAPS_API_KEY: amapApiKey, BOCHA_API_KEY: bochaApiKey, TOOL_POLICY: policy };
  const oldContent = await readFileOrEmpty(filePath);
  const lines = oldContent ? oldContent.split(/\r?\n/) : [];
  const next = lines.filter((line) => !MODEL_KEYS.includes(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1]));
  next.push(...MODEL_KEYS.map((key) => `${key}=${quoteEnv(values[key])}`));
  await fs.writeFile(filePath, `${next.filter((line, index) => index < next.length - 1 || line).join("\n").trimEnd()}\n`, { encoding: "utf8", mode: 0o600 });
  return { baseUrl, model, policy, apiKeyConfigured: Boolean(apiKey), apiKey, embeddingBaseUrl, embeddingModel, embeddingDimensions, embeddingFormat, embeddingApiKeyConfigured: Boolean(embeddingApiKey || apiKey), embeddingApiKeySeparateConfigured: Boolean(embeddingApiKey), embeddingApiKey, amapApiKeyConfigured: Boolean(amapApiKey), amapApiKey, bochaApiKeyConfigured: Boolean(bochaApiKey), bochaApiKey };
}

export async function publicModelConfig(filePath, effective = {}) {
  const saved = await readEnv(filePath);
  return {
    baseUrl: String(effective.baseUrl ?? saved.LLM_BASE_URL ?? ""),
    model: String(effective.model ?? saved.LLM_MODEL ?? ""),
    embeddingBaseUrl: String(effective.embeddingBaseUrl ?? saved.EMBEDDING_BASE_URL ?? ""),
    embeddingModel: String(effective.embeddingModel ?? saved.EMBEDDING_MODEL ?? ""),
    embeddingDimensions: String(effective.embeddingDimensions ?? saved.EMBEDDING_DIMENSIONS ?? ""),
    embeddingFormat: String(effective.embeddingFormat ?? saved.EMBEDDING_API_FORMAT ?? "auto"),
    embeddingApiKeyConfigured: Boolean(effective.embeddingApiKey || effective.apiKey || saved.EMBEDDING_API_KEY || saved.LLM_API_KEY),
    embeddingApiKeySeparateConfigured: Boolean(effective.embeddingApiKey || saved.EMBEDDING_API_KEY),
    amapApiKeyConfigured: Boolean(effective.amapApiKey || saved.AMAP_MAPS_API_KEY),
    bochaApiKeyConfigured: Boolean(effective.bochaApiKey || saved.BOCHA_API_KEY),
    policy: String(effective.policy ?? saved.TOOL_POLICY ?? "always-ask"),
    apiKeyConfigured: Boolean(effective.apiKey || saved.LLM_API_KEY)
  };
}

export function autoApproveTool(policy, name, permission) {
  if (policy === "allow-all") return true;
  if (policy === "read-only") return permission === "r";
  if (policy === "workspace-write") return permission === "r" || name === "write_file";
  return false;
}

export async function saveRuntimeConfig(filePath, input, current) {
  const policy = input.policy ?? current.policy;
  const memoryAutoLearn = input.memoryAutoLearn ?? current.memoryAutoLearn;
  const sandboxNetwork = input.sandboxNetwork ?? current.sandboxNetwork ?? "none";
  if (!TOOL_POLICIES.includes(policy)) throw new Error("审批模式无效");
  if (typeof memoryAutoLearn !== "boolean") throw new Error("自动学习开关必须是布尔值");
  if (!["none", "allow"].includes(sandboxNetwork)) throw new Error("命令联网设置无效");
  const content = await readFileOrEmpty(filePath);
  const lines = content.split(/\r?\n/).filter((line) => !/^\s*(?:export\s+)?(?:TOOL_POLICY|MEMORY_AUTO_LEARN|SANDBOX_NETWORK)\s*=/.test(line));
  lines.push(`TOOL_POLICY=${quoteEnv(policy)}`, `MEMORY_AUTO_LEARN=${quoteEnv(memoryAutoLearn)}`, `SANDBOX_NETWORK=${quoteEnv(sandboxNetwork)}`);
  await fs.writeFile(filePath, `${lines.join("\n").trim()}\n`, { encoding: "utf8", mode: 0o600 });
  return { policy, memoryAutoLearn, sandboxNetwork };
}

function parseEnv(content) {
  const result = {};
  for (const line of String(content).split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else value = value.replace(/\s+#.*$/, "");
    result[match[1]] = value;
  }
  return result;
}

function quoteEnv(value) { return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`; }
function normalizeDimensions(value) { const number = Number(value); return value === "" || value == null ? "" : Number.isInteger(number) && number > 0 ? String(number) : ""; }
async function readEnv(filePath) { return parseEnv(await readFileOrEmpty(filePath)); }
async function readFileOrEmpty(filePath) { try { return await fs.readFile(filePath, "utf8"); } catch (error) { if (error.code === "ENOENT") return ""; throw error; } }
