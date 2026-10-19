import { ProjectRuntimeRegistry } from "./project-runtime-registry.mjs";

export function createLocalGateway(options) {
  const projects = new ProjectRuntimeRegistry(options);
  const sessions = {
    list(runtime) {
      return [...runtime.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    get(runtime, sessionId) {
      return runtime.sessions.get(String(sessionId)) || null;
    },
  };

  return {
    projects,
    sessions,
    async init() { return await projects.init(); },
    async resolve(projectId, sessionId = null) {
      const runtime = await projects.get(projectId || "default");
      return { runtime, session: sessionId == null ? null : sessions.get(runtime, sessionId) };
    },
  };
}
