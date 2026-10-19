const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentHarnessDesktop", {
  selectProjectFolder: () => ipcRenderer.invoke("agent-harness:select-project-folder"),
  registerProjectFolder: (project) => ipcRenderer.invoke("agent-harness:register-project-folder", project)
});
