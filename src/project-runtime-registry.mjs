import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const PROJECT_ID_PATTERN = /^project-[a-f0-9]{12}$/;

export class ProjectRuntimeRegistry {
  constructor({ dataRoot, defaultWorkspaceRoot, createRuntime }) {
    this.dataRoot = path.resolve(dataRoot);
    this.defaultWorkspaceRoot = path.resolve(defaultWorkspaceRoot);
    this.projectsRoot = path.join(this.dataRoot, "projects");
    this.manifestPath = path.join(this.dataRoot, "projects.json");
    this.createRuntime = createRuntime;
    this.projects = new Map();
    this.runtimes = new Map();
    this.runtimeInitializations = new Map();
    this.pending = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.defaultWorkspaceRoot, { recursive: true });
    const defaultProject = {
      id: "default",
      name: "项目",
      workspaceRoot: this.defaultWorkspaceRoot,
      dataRoot: this.dataRoot,
      createdAt: new Date().toISOString(),
      isDefault: true,
    };
    this.projects.set(defaultProject.id, defaultProject);

    const saved = await this.readManifest();
    for (const entry of saved) {
      if (!entry || !PROJECT_ID_PATTERN.test(entry.id) || typeof entry.name !== "string") continue;
      const projectRoot = path.join(this.projectsRoot, entry.id);
      this.projects.set(entry.id, {
        id: entry.id,
        name: entry.name,
        workspaceRoot: entry.externalWorkspace && typeof entry.workspaceRoot === "string"
          ? path.resolve(entry.workspaceRoot)
          : path.join(projectRoot, "workspace"),
        externalWorkspace: Boolean(entry.externalWorkspace && typeof entry.workspaceRoot === "string"),
        dataRoot: path.join(projectRoot, "data"),
        createdAt: entry.createdAt || new Date().toISOString(),
        isDefault: false,
      });
    }

    await fs.mkdir(this.projectsRoot, { recursive: true });
    const runtime = await this.initializeRuntime(defaultProject);
    return runtime;
  }

  list() {
    return [...this.projects.values()].map(({ id, name, createdAt, isDefault, externalWorkspace }) => ({ id, name, createdAt, isDefault, linkedFolder: Boolean(externalWorkspace) }));
  }

  async get(id = "default") {
    const project = this.projects.get(String(id));
    if (!project) throw httpError(404, "项目不存在");
    const cached = this.runtimes.get(project.id);
    if (cached) return cached;
    return await this.initializeRuntime(project);
  }

  async create(name, { workspaceRoot: linkedWorkspace = null } = {}) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName || normalizedName.length > 60) throw httpError(400, "项目名称需为 1–60 个字符");
    return await this.serialize(async () => {
      if ([...this.projects.values()].some((project) => project.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) {
        throw httpError(409, "项目名称已存在");
      }
      let workspaceRoot = null;
      if (linkedWorkspace) {
        try {
          workspaceRoot = await fs.realpath(path.resolve(String(linkedWorkspace)));
          const stat = await fs.stat(workspaceRoot);
          if (!stat.isDirectory()) throw new Error("not a directory");
        } catch (error) {
          if (error.statusCode) throw error;
          throw httpError(400, "所选项目文件夹无法访问");
        }
        if (path.parse(workspaceRoot).root === workspaceRoot) throw httpError(400, "不能将磁盘根目录用作项目文件夹");
        for (const project of this.projects.values()) {
          if (pathsOverlap(project.workspaceRoot, workspaceRoot)) throw httpError(409, "所选文件夹与已有项目工作区重叠");
        }
      }
      const id = `project-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const projectRoot = path.join(this.projectsRoot, id);
      const project = {
        id,
        name: normalizedName,
        workspaceRoot: workspaceRoot || path.join(projectRoot, "workspace"),
        externalWorkspace: Boolean(workspaceRoot),
        dataRoot: path.join(projectRoot, "data"),
        createdAt: new Date().toISOString(),
        isDefault: false,
      };
      if (!project.externalWorkspace) await fs.mkdir(project.workspaceRoot, { recursive: true });
      await fs.mkdir(project.dataRoot, { recursive: true });
      const runtime = await this.initializeRuntime(project);
      this.projects.set(id, project);
      try {
        await this.writeManifest();
      } catch (error) {
        this.projects.delete(id);
        this.runtimes.delete(id);
        runtime.store?.close?.();
        throw error;
      }
      return { project: this.list().find((entry) => entry.id === id), runtime };
    });
  }

  loadedRuntimes() {
    return [...this.runtimes.values()];
  }

  async initializeRuntime(project) {
    const existing = this.runtimes.get(project.id);
    if (existing) return existing;
    const pending = this.runtimeInitializations.get(project.id);
    if (pending) return await pending;
    const initializing = (async () => {
      if (project.externalWorkspace) {
        try {
          const stat = await fs.stat(project.workspaceRoot);
          if (!stat.isDirectory()) throw new Error("not a directory");
        } catch {
          throw httpError(400, `项目文件夹不可用：${project.name}`);
        }
      } else await fs.mkdir(project.workspaceRoot, { recursive: true });
      await fs.mkdir(project.dataRoot, { recursive: true });
      const runtime = await this.createRuntime(project);
      this.runtimes.set(project.id, runtime);
      return runtime;
    })();
    this.runtimeInitializations.set(project.id, initializing);
    try { return await initializing; }
    finally { this.runtimeInitializations.delete(project.id); }
  }

  async readManifest() {
    try {
      const data = JSON.parse(await fs.readFile(this.manifestPath, "utf8"));
      if (!Array.isArray(data.projects)) throw new Error("项目配置格式无效");
      return data.projects;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeManifest() {
    const temp = `${this.manifestPath}.${randomUUID()}.tmp`;
    const projects = [...this.projects.values()].filter((project) => !project.isDefault).map(({ id, name, createdAt, workspaceRoot, externalWorkspace }) => ({ id, name, createdAt, ...(externalWorkspace ? { workspaceRoot, externalWorkspace: true } : {}) }));
    try {
      await fs.writeFile(temp, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temp, this.manifestPath);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }

  serialize(operation) {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function pathsOverlap(first, second) {
  return isInside(first, second) || isInside(second, first);
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
