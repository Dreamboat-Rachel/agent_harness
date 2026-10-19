import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("HTTP API keeps sessions, models, memory and workspace scoped to the selected project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-harness-project-http-"));
  const portFile = path.join(root, "port");
  const serverFile = fileURLToPath(new URL("../src/server.mjs", import.meta.url));
  const child = spawn(process.execPath, [serverFile], {
    cwd: path.dirname(path.dirname(serverFile)),
    env: { ...process.env, PENGUIN_HOME: path.join(root, "data"), PENGUIN_WORKSPACE: path.join(root, "default-workspace"), PENGUIN_ENV_FILE: path.join(root, "missing.env"), PENGUIN_PORT_FILE: portFile, HOST: "127.0.0.1", PORT: "0" },
    stdio: "ignore",
  });
  let baseUrl;
  const request = async (route, projectId = "default", options = {}) => {
    const response = await fetch(`${baseUrl}/api${route}`, {
      ...options,
      headers: { "content-type": "application/json", "x-project-id": projectId, ...(options.headers || {}) },
    });
    return { status: response.status, data: await response.json() };
  };

  try {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
      try {
        const port = Number(await readFile(portFile, "utf8"));
        if (port > 0) { baseUrl = `http://127.0.0.1:${port}`; break; }
      } catch { /* The server has not announced its port yet. */ }
      await delay(50);
    }
    assert.ok(baseUrl, "server should announce an ephemeral port");

    const created = await request("/projects", "default", { method: "POST", body: JSON.stringify({ name: "Isolated" }) });
    assert.equal(created.status, 201);
    const projectId = created.data.project.id;

    const imported = await request("/projects/import-files", "default", {
      method: "POST",
      body: JSON.stringify({ name: "Imported Folder", files: [{ path: "src/example.txt", content: Buffer.from("browser import works", "utf8").toString("base64") }] }),
    });
    assert.equal(imported.status, 201);
    assert.equal(imported.data.importedFiles, 1);
    const importedWorkspace = (await request("/capabilities", imported.data.project.id)).data.workspace;
    assert.equal(await readFile(path.join(importedWorkspace, "src", "example.txt"), "utf8"), "browser import works");
    const projectFiles = await request("/projects/files", imported.data.project.id);
    assert.equal(projectFiles.status, 200);
    assert.deepEqual(projectFiles.data.files.map(({ path: filePath, directory }) => [filePath, directory]), [["src", true], ["src/example.txt", false]]);

    const chunkOne = await request("/projects/files?path=src%2Fchunked.txt&offset=0", imported.data.project.id, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: Buffer.from("first-") });
    const chunkTwo = await request("/projects/files?path=src%2Fchunked.txt&offset=6", imported.data.project.id, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: Buffer.from("second") });
    assert.equal(chunkOne.status, 200);
    assert.equal(chunkTwo.data.nextOffset, 12);
    assert.equal(await readFile(path.join(importedWorkspace, "src", "chunked.txt"), "utf8"), "first-second");

    const defaultSession = await request("/sessions", "default", { method: "POST", body: "{}" });
    const projectSession = await request("/sessions", projectId, { method: "POST", body: "{}" });
    assert.equal(projectSession.data.projectId, projectId, "a project conversation is owned by the selected project runtime");
    assert.equal((await request("/sessions", "default")).data.length, 1);
    assert.equal((await request("/sessions", projectId)).data.length, 1);
    assert.equal((await request(`/sessions/${projectSession.data.id}`, "default")).status, 404);
    assert.equal((await request(`/sessions/${defaultSession.data.id}`, projectId)).status, 404);

    const libraryUpload = await request("/library", projectId, { method: "POST", body: JSON.stringify({ files: [{ name: "project-notes.md", content: "This project knowledge belongs to the selected project." }] }) });
    assert.equal(libraryUpload.status, 201);
    const libraryDocumentId = libraryUpload.data.documents[0].id;
    assert.equal((await request("/library", projectId)).data.documents.length, 1);
    assert.equal((await request("/library", "default")).data.documents.length, 0);
    assert.match((await request(`/library/${libraryDocumentId}`, projectId)).data.content, /selected project/);
    assert.deepEqual((await request("/library/search?query=selected%20project", projectId)).data.results.map(({ name }) => name), ["project-notes.md"]);
    const graphPreviewWithoutModel = await request(`/library/${libraryDocumentId}/graph-preview`, projectId, { method: "POST", body: "{}" });
    assert.equal(graphPreviewWithoutModel.status, 409);
    assert.match(graphPreviewWithoutModel.data.error, /连接模型/);

    const projectModels = await request("/models", projectId, { method: "POST", body: JSON.stringify({ name: "Local Test", provider: "OpenAI-compatible", baseUrl: "http://127.0.0.1:1/v1", model: "test-model", apiKey: "test-key", enabled: true }) });
    assert.equal(projectModels.status, 201);
    assert.equal((await request("/models", "default")).data.models.length, 0);
    assert.equal((await request("/models", projectId)).data.models.length, 1);

    const graphPreviewUnavailable = await request(`/library/${libraryDocumentId}/graph-preview`, projectId, { method: "POST", body: "{}" });
    assert.equal(graphPreviewUnavailable.status, 502);
    assert.match(graphPreviewUnavailable.data.error, /连接模型服务失败/);

    await request("/knowledge/memory", projectId, { method: "PUT", body: JSON.stringify({ content: "project-only-memory-sentinel" }) });
    assert.match((await request("/knowledge", projectId)).data.memory, /project-only-memory-sentinel/);
    assert.doesNotMatch((await request("/knowledge", "default")).data.memory, /project-only-memory-sentinel/);
    assert.match((await request("/capabilities", projectId)).data.workspace, new RegExp(projectId));

    assert.equal((await request(`/library/${libraryDocumentId}`, "default", { method: "DELETE" })).status, 404);
    assert.equal((await request(`/library/${libraryDocumentId}`, projectId, { method: "DELETE" })).status, 200);

    const removeImported = await request(`/projects/${imported.data.project.id}`, "default", { method: "DELETE" });
    assert.equal(removeImported.status, 200);
    assert.equal(removeImported.data.deleted, true);
    assert.equal((await request(`/sessions`, imported.data.project.id)).status, 404);
    assert.equal((await request(`/projects/default`, "default", { method: "DELETE" })).status, 404);
  } finally {
    child.kill();
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2000)]);
    await rm(root, { recursive: true, force: true });
  }
});
