import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProjectRuntimeRegistry } from "../src/project-runtime-registry.mjs";

test("project registry shares concurrent initialization and persists project metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-harness-projects-"));
  let creates = 0;
  const registry = new ProjectRuntimeRegistry({
    dataRoot: path.join(root, "data"),
    defaultWorkspaceRoot: path.join(root, "workspace"),
    async createRuntime(project) {
      creates += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { id: project.id, store: { close() {} } };
    },
  });

  try {
    await registry.init();
    const [first, second] = await Promise.all([registry.get("default"), registry.get("default")]);
    assert.equal(first, second);
    assert.equal(creates, 1);

    const { project } = await registry.create("研发项目");
    assert.match(project.id, /^project-[a-f0-9]{12}$/);
    assert.deepEqual(registry.list().map(({ id }) => id), ["default", project.id]);
    const saved = JSON.parse(await readFile(path.join(root, "data", "projects.json"), "utf8"));
    assert.equal(saved.projects[0].name, "研发项目");

    const reloaded = new ProjectRuntimeRegistry({
      dataRoot: path.join(root, "data"),
      defaultWorkspaceRoot: path.join(root, "workspace"),
      createRuntime: async (entry) => ({ id: entry.id, store: { close() {} } }),
    });
    await reloaded.init();
    assert.equal(reloaded.list().find((entry) => entry.id === project.id).name, "研发项目");
  } finally {
    for (const runtime of registry.loadedRuntimes()) runtime.store?.close?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("project registry links external folders and rejects overlapping workspaces", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-harness-linked-project-"));
  const externalWorkspace = path.join(root, "repo");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(externalWorkspace, { recursive: true }));
  const registry = new ProjectRuntimeRegistry({
    dataRoot: path.join(root, "data"),
    defaultWorkspaceRoot: path.join(root, "workspace"),
    createRuntime: async (project) => ({ id: project.id, workspaceRoot: project.workspaceRoot }),
  });

  try {
    await registry.init();
    const { project, runtime } = await registry.create("代码项目", { workspaceRoot: externalWorkspace });
    assert.equal(project.linkedFolder, true);
    assert.equal(runtime.workspaceRoot, externalWorkspace);
    await assert.rejects(registry.create("重叠目录", { workspaceRoot: root }), /重叠/);

    const saved = JSON.parse(await readFile(path.join(root, "data", "projects.json"), "utf8"));
    assert.equal(saved.projects[0].workspaceRoot, externalWorkspace);
    assert.equal(saved.projects[0].externalWorkspace, true);

    const reloaded = new ProjectRuntimeRegistry({
      dataRoot: path.join(root, "data"),
      defaultWorkspaceRoot: path.join(root, "workspace"),
      createRuntime: async (entry) => ({ id: entry.id, workspaceRoot: entry.workspaceRoot }),
    });
    await reloaded.init();
    assert.equal((await reloaded.get(project.id)).workspaceRoot, externalWorkspace);
  } finally {
    for (const runtime of registry.loadedRuntimes()) runtime.store?.close?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("project removal protects the default and external workspace while deleting project data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-harness-project-remove-"));
  const externalWorkspace = path.join(root, "external-repo");
  await mkdir(externalWorkspace, { recursive: true });
  const registry = new ProjectRuntimeRegistry({
    dataRoot: path.join(root, "data"),
    defaultWorkspaceRoot: path.join(root, "workspace"),
    createRuntime: async (project) => ({
      ...project,
      sessions: new Map(),
      store: { closed: false, close() { this.closed = true; } },
    }),
  });

  try {
    await registry.init();
    await assert.rejects(registry.remove("default"), /默认工作区不能删除/);

    const imported = await registry.create("内部项目");
    const importedRoot = path.join(root, "data", "projects", imported.project.id);
    const importedRuntime = await registry.get(imported.project.id);
    await mkdir(path.join(importedRoot, "workspace"), { recursive: true });
    importedRuntime.sessions.set("running", { status: "running" });
    await assert.rejects(registry.remove(imported.project.id), /正在运行/);
    importedRuntime.sessions.delete("running");
    const removed = await registry.remove(imported.project.id);
    assert.equal(removed.deleted, true);
    await assert.rejects(access(importedRoot), { code: "ENOENT" });
    assert.equal(importedRuntime.store.closed, true);

    const linked = await registry.create("外部项目", { workspaceRoot: externalWorkspace });
    const linkedRoot = path.join(root, "data", "projects", linked.project.id);
    await registry.remove(linked.project.id);
    await access(externalWorkspace);
    await assert.rejects(access(linkedRoot), { code: "ENOENT" });
    assert.deepEqual(registry.list().map(({ id }) => id), ["default"]);
  } finally {
    for (const runtime of registry.loadedRuntimes()) runtime.store?.close?.();
    await rm(root, { recursive: true, force: true });
  }
});
