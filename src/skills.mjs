import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import yaml from "js-yaml";

const MAX_FILES = 200;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const REGISTRY_FILE = ".registry.json";

export const SKILL_CATALOG = [
  { id: "anthropic-frontend-design", name: "frontend-design", title: "前端界面设计", publisher: "Anthropic", category: "设计开发", description: "创建具有鲜明视觉风格、可直接投入使用的前端界面。", url: "https://github.com/anthropics/skills/tree/main/skills/frontend-design" },
  { id: "anthropic-webapp-testing", name: "webapp-testing", title: "Web 应用测试", publisher: "Anthropic", category: "开发测试", description: "使用浏览器测试本地 Web 应用并排查界面问题。", url: "https://github.com/anthropics/skills/tree/main/skills/webapp-testing" },
  { id: "anthropic-pdf", name: "pdf", title: "PDF 处理", publisher: "Anthropic", category: "文档办公", description: "读取、创建和检查 PDF 文档。", url: "https://github.com/anthropics/skills/tree/main/skills/pdf" },
  { id: "anthropic-docx", name: "docx", title: "Word 文档", publisher: "Anthropic", category: "文档办公", description: "创建、编辑和检查专业 Word 文档。", url: "https://github.com/anthropics/skills/tree/main/skills/docx" },
  { id: "anthropic-pptx", name: "pptx", title: "演示文稿", publisher: "Anthropic", category: "文档办公", description: "创建和编辑演示文稿，并检查页面效果。", url: "https://github.com/anthropics/skills/tree/main/skills/pptx" },
  { id: "anthropic-xlsx", name: "xlsx", title: "电子表格", publisher: "Anthropic", category: "文档办公", description: "创建、分析和检查电子表格。", url: "https://github.com/anthropics/skills/tree/main/skills/xlsx" },
  { id: "anthropic-mcp-builder", name: "mcp-builder", title: "MCP 服务开发", publisher: "Anthropic", category: "工具扩展", description: "设计和实现高质量 MCP 服务。", url: "https://github.com/anthropics/skills/tree/main/skills/mcp-builder" },
  { id: "anthropic-skill-creator", name: "skill-creator", title: "Skill 创建器", publisher: "Anthropic", category: "工具扩展", description: "创建、组织和改进标准 SKILL.md 技能包。", url: "https://github.com/anthropics/skills/tree/main/skills/skill-creator" }
];

export class SkillManager {
  constructor(root, { fetchImpl = globalThis.fetch } = {}) {
    this.root = path.resolve(root);
    this.registryFile = path.join(this.root, REGISTRY_FILE);
    this.fetchImpl = fetchImpl;
    this.registry = { skills: {} };
    this.registrySave = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.root, { recursive: true });
    await fs.mkdir(path.join(this.root, ".trash"), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.registryFile, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.skills && typeof parsed.skills === "object") this.registry = parsed;
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error(`技能注册信息无法读取：${error.message}`);
      await this.#saveRegistry();
    }
  }

  async list() {
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      try {
        validateSkillName(entry.name);
        const content = await this.#readManifest(await this.#realSkillRoot(entry.name));
        const metadata = parseSkillDocument(content, entry.name);
        const record = this.registry.skills[entry.name] || {};
        skills.push({
          name: entry.name,
          title: String(metadata.title || metadata.name || entry.name),
          description: String(metadata.description || ""),
          enabled: record.enabled !== false,
          source: record.source || { type: "local", label: "本机" },
          installedAt: record.installedAt || null
        });
      } catch { }
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  async library() {
    const installed = await this.list();
    const installedNames = new Set(installed.map((skill) => skill.name));
    return {
      installed,
      catalog: SKILL_CATALOG.map((skill) => ({ ...skill, installed: installedNames.has(skill.name) }))
    };
  }

  async read(name) {
    return await this.readFile(name, "SKILL.md");
  }

  async readFile(name, relativePath) {
    validateSkillName(name);
    const installed = (await this.list()).find((skill) => skill.name === name);
    if (!installed) throw httpError(404, `未找到 Skill：${name}`);
    if (!installed.enabled) throw httpError(409, `Skill 已停用：${name}`);
    const skillRoot = await this.#realSkillRoot(name);
    const normalized = normalizeRelativePath(relativePath || "");
    if (!normalized) return JSON.stringify(await listFiles(skillRoot), null, 2);
    const file = path.resolve(skillRoot, ...normalized.split("/"));
    if (!inside(skillRoot, file)) throw httpError(400, "Skill 文件路径无效");
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) throw httpError(404, "Skill 文件不存在");
    const real = await fs.realpath(file);
    if (!inside(skillRoot, real)) throw httpError(400, "Skill 文件路径越界");
    if (stat.size > MAX_FILE_BYTES) throw httpError(413, "Skill 文件过大，无法作为文本读取");
    const content = await fs.readFile(real);
    if (content.includes(0)) throw httpError(415, "该 Skill 文件不是文本文件");
    return content.toString("utf8");
  }

  async details(name) {
    validateSkillName(name);
    const skill = (await this.list()).find((item) => item.name === name);
    if (!skill) throw httpError(404, `未找到 Skill：${name}`);
    const root = await this.#realSkillRoot(name);
    return { ...skill, content: await this.#readManifest(root), files: await listFiles(root) };
  }

  async installCatalog(id) {
    const entry = SKILL_CATALOG.find((skill) => skill.id === id);
    if (!entry) throw httpError(404, "精选 Skill 不存在");
    return await this.installGitHub(entry.url, { label: `${entry.publisher} / ${entry.title}`, catalogId: entry.id });
  }

  async installGitHub(url, sourceExtra = {}) {
    const source = parseGitHubSkillUrl(url);
    const files = [];
    let totalBytes = 0;
    let directories = 0;
    const visit = async (directory, depth = 0) => {
      if (++directories > MAX_FILES || depth > 16) throw httpError(413, "Skill 文件夹数量或层级过多");
      const apiUrl = `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/contents/${directory.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(source.ref)}`;
      const response = await this.#fetch(apiUrl);
      const items = JSON.parse((await readResponseLimited(response, MAX_FILE_BYTES)).toString("utf8"));
      if (!Array.isArray(items)) throw httpError(400, "GitHub 地址不是 Skill 文件夹");
      for (const item of items) {
        if (typeof item.path !== "string" || !item.path.startsWith(`${directory}/`) || item.path.slice(directory.length + 1).includes("/")) throw httpError(400, "GitHub 返回的文件路径无效");
        normalizeRelativePath(item.path);
        if (files.length >= MAX_FILES) throw httpError(413, `Skill 文件不能超过 ${MAX_FILES} 个`);
        if (item.type === "dir") {
          await visit(item.path, depth + 1);
        } else if (item.type === "file") {
          if (Number(item.size) > MAX_FILE_BYTES) throw httpError(413, `文件过大：${item.name}`);
          const download = await this.#fetch(item.download_url);
          const buffer = await readResponseLimited(download, MAX_FILE_BYTES);
          totalBytes += buffer.length;
          if (totalBytes > MAX_TOTAL_BYTES) throw httpError(413, "Skill 总大小超过 12 MB");
          files.push({ path: item.path.slice(source.skillPath.length).replace(/^\//, ""), content: buffer.toString("base64"), encoding: "base64" });
        }
      }
    };
    await visit(source.skillPath);
    return await this.installFiles(files, { type: "github", label: sourceExtra.label || `${source.owner}/${source.repo}`, url: source.webUrl, ...sourceExtra });
  }

  async installFiles(inputFiles, source = { type: "import", label: "本机导入" }) {
    if (!Array.isArray(inputFiles) || inputFiles.length === 0) throw httpError(400, "请选择包含 SKILL.md 的技能文件夹");
    if (inputFiles.length > MAX_FILES) throw httpError(413, `Skill 文件不能超过 ${MAX_FILES} 个`);
    const normalized = inputFiles.map((file) => ({ ...file, path: normalizeRelativePath(file.path) }));
    const manifests = normalized.filter((file) => /(^|\/)SKILL\.md$/i.test(file.path));
    if (manifests.length !== 1) throw httpError(400, "每次只能导入一个且必须包含 SKILL.md");
    const prefix = manifests[0].path.slice(0, -"SKILL.md".length);
    const files = normalized.map((file) => {
      if (!file.path.startsWith(prefix)) throw httpError(400, "导入内容必须位于同一个 Skill 文件夹内");
      return { ...file, path: file.path.slice(prefix.length) };
    });
    let totalBytes = 0;
    const decoded = files.map((file) => {
      if (!file.path) throw httpError(400, "Skill 文件路径无效");
      const content = file.encoding === "base64" ? Buffer.from(String(file.content || ""), "base64") : Buffer.from(String(file.content || ""), "utf8");
      if (content.length > MAX_FILE_BYTES) throw httpError(413, `文件过大：${file.path}`);
      totalBytes += content.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw httpError(413, "Skill 总大小超过 12 MB");
      return { path: file.path, content };
    });
    const manifest = decoded.find((file) => file.path.toLowerCase() === "skill.md");
    if (!manifest || manifest.content.includes(0)) throw httpError(400, "SKILL.md 必须是文本文件");
    manifest.path = "SKILL.md";
    if (new Set(decoded.map((file) => file.path.toLowerCase())).size !== decoded.length) throw httpError(400, "Skill 中存在重复文件路径");
    const metadata = parseSkillDocument(manifest.content.toString("utf8"));
    validateSkillName(metadata.name);
    const name = metadata.name;
    const target = path.join(this.root, name);
    if (await exists(target)) throw httpError(409, `Skill“${name}”已安装`);
    const staging = path.join(this.root, `.install-${randomUUID()}`);
    try {
      await fs.mkdir(staging, { recursive: true });
      for (const file of decoded) {
        const destination = path.resolve(staging, ...file.path.split("/"));
        if (!inside(staging, destination)) throw httpError(400, "Skill 文件路径无效");
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, file.content);
      }
      await fs.rename(staging, target);
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    this.registry.skills[name] = { enabled: true, source, installedAt: new Date().toISOString() };
    await this.#saveRegistry();
    return await this.library();
  }

  async setEnabled(name, enabled) {
    validateSkillName(name);
    if (!await exists(path.join(this.root, name, "SKILL.md"))) throw httpError(404, `未找到 Skill：${name}`);
    const previous = this.registry.skills[name] || {};
    this.registry.skills[name] = { ...previous, enabled: Boolean(enabled), source: previous.source || { type: "local", label: "本机" }, installedAt: previous.installedAt || null };
    await this.#saveRegistry();
    return await this.library();
  }

  async remove(name) {
    validateSkillName(name);
    const source = path.join(this.root, name);
    const stat = await fs.lstat(source).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw httpError(404, `未找到 Skill：${name}`);
    const trash = path.join(this.root, ".trash", `${name}-${Date.now()}-${randomUUID().slice(0, 8)}`);
    await fs.rename(source, trash);
    delete this.registry.skills[name];
    await this.#saveRegistry();
    return await this.library();
  }

  async #fetch(url) {
    if (!url || (!url.startsWith("https://api.github.com/") && !url.startsWith("https://raw.githubusercontent.com/") && !url.startsWith("https://github.com/"))) throw httpError(400, "只允许从公开 GitHub 地址安装 Skill");
    let response;
    try {
      response = await this.fetchImpl(url, { headers: { accept: "application/vnd.github+json", "user-agent": "Agent-Harness-Skills" }, signal: AbortSignal.timeout(30000), redirect: "error" });
    } catch (error) {
      throw httpError(502, `无法连接 GitHub：${error.message}`);
    }
    if (!response.ok) throw httpError(response.status === 404 ? 404 : 502, `GitHub 下载失败（${response.status}）`);
    return response;
  }

  async #realSkillRoot(name) {
    const expected = path.join(this.root, name);
    const real = await fs.realpath(expected).catch(() => null);
    const rootReal = await fs.realpath(this.root);
    if (!real || !inside(rootReal, real)) throw httpError(404, `未找到 Skill：${name}`);
    const stat = await fs.lstat(expected);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw httpError(400, "Skill 目录无效");
    return real;
  }

  async #saveRegistry() {
    const content = `${JSON.stringify(this.registry, null, 2)}\n`;
    const saved = this.registrySave.then(async () => {
      const staging = `${this.registryFile}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(staging, content, "utf8");
        await fs.rename(staging, this.registryFile);
      } finally { await fs.rm(staging, { force: true }).catch(() => {}); }
    });
    this.registrySave = saved.catch(() => {});
    await saved;
  }

  async #readManifest(root) {
    const file = path.join(root, "SKILL.md");
    const stat = await fs.lstat(file);
    const real = await fs.realpath(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !inside(root, real)) throw httpError(400, "SKILL.md 文件无效");
    if (stat.size > MAX_FILE_BYTES) throw httpError(413, "SKILL.md 文件过大");
    return await fs.readFile(real, "utf8");
  }
}

export function parseSkillDocument(content, fallbackName = "") {
  const text = String(content || "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) throw httpError(400, "SKILL.md 缺少 YAML 元数据");
  let metadata;
  try { metadata = yaml.load(match[1]); } catch (error) { throw httpError(400, `SKILL.md 元数据格式错误：${error.message}`); }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw httpError(400, "SKILL.md 元数据必须是对象");
  const name = String(metadata.name || fallbackName || "").trim();
  if (!name) throw httpError(400, "SKILL.md 缺少 name");
  return { ...metadata, name, description: String(metadata.description || "").trim() };
}

export function parseGitHubSkillUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw httpError(400, "GitHub Skill 地址无效"); }
  if (url.protocol !== "https:") throw httpError(400, "GitHub Skill 地址必须使用 HTTPS");
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  let owner; let repo; let ref; let skillPath;
  if (url.hostname === "github.com" && segments.length >= 5 && ["tree", "blob"].includes(segments[2])) {
    [owner, repo] = segments; ref = segments[3]; skillPath = segments.slice(4).join("/");
    if (segments[2] === "blob" && /(^|\/)SKILL\.md$/i.test(skillPath)) skillPath = skillPath.replace(/(^|\/)SKILL\.md$/i, "");
  } else if (url.hostname === "raw.githubusercontent.com" && segments.length >= 4) {
    [owner, repo, ref] = segments; skillPath = segments.slice(3).join("/").replace(/(^|\/)SKILL\.md$/i, "");
  } else {
    throw httpError(400, "请填写 GitHub 中 Skill 文件夹或 SKILL.md 的公开链接");
  }
  if (![owner, repo, ref, skillPath].every(Boolean) || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) throw httpError(400, "GitHub Skill 地址无效");
  return { owner, repo, ref, skillPath, webUrl: `https://github.com/${owner}/${repo}/tree/${ref}/${skillPath}` };
}

function validateSkillName(name) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(String(name || ""))) throw httpError(400, "invalid skill name");
}

function normalizeRelativePath(value) {
  const raw = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!raw) return "";
  if (/[\0:]/.test(raw) || raw.startsWith("/") || raw.split("/").includes("..")) throw httpError(400, "Skill 文件路径无效");
  return path.posix.normalize(raw);
}

async function readResponseLimited(response, limit) {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw httpError(413, "GitHub 文件超过大小限制");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw httpError(413, "GitHub 文件超过大小限制");
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

async function listFiles(root) {
  const output = [];
  const visit = async (directory, prefix = "") => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), relative);
      else if (entry.isFile()) output.push(relative);
    }
  };
  await visit(root);
  return output.sort();
}

function inside(root, target) { return target === root || target.startsWith(`${root}${path.sep}`); }
async function exists(target) { try { await fs.access(target); return true; } catch { return false; } }
function httpError(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; return error; }
