const { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } = require("electron");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 100;
const SMOKE_MODE = process.env.PENGUIN_DESKTOP_SMOKE === "1";

let mainWindow = null;
let serverProcess = null;
let serverOrigin = "";
let desktopToken = "";
let quitting = false;
let stopPromise = null;

ipcMain.handle("agent-harness:select-project-folder", async (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame || !serverOrigin || !desktopToken) {
    throw new Error("项目目录选择请求无效");
  }
  let frameOrigin = "";
  try { frameOrigin = new URL(event.senderFrame.url).origin; } catch { }
  if (frameOrigin !== new URL(serverOrigin).origin) throw new Error("项目目录只能由应用主窗口选择");

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择本机项目文件夹",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return { cancelled: true };
  const selectedPath = fs.realpathSync(result.filePaths[0]);
  if (!fs.statSync(selectedPath).isDirectory() || path.parse(selectedPath).root === selectedPath) {
    throw new Error("请选择一个具体的项目文件夹");
  }

  return { name: path.basename(selectedPath), workspacePath: selectedPath };
});

ipcMain.handle("agent-harness:register-project-folder", async (event, input = {}) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame || !serverOrigin || !desktopToken) {
    throw new Error("项目目录注册请求无效");
  }
  let frameOrigin = "";
  try { frameOrigin = new URL(event.senderFrame.url).origin; } catch { }
  if (frameOrigin !== new URL(serverOrigin).origin) throw new Error("项目目录只能由应用主窗口注册");
  const selectedPath = fs.realpathSync(path.resolve(String(input.workspacePath || "")));
  if (!fs.statSync(selectedPath).isDirectory() || path.parse(selectedPath).root === selectedPath) {
    throw new Error("请选择一个具体的项目文件夹");
  }

  const response = await fetch(`${serverOrigin}/api/desktop/projects/from-folder`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${desktopToken}` },
    body: JSON.stringify({ name: String(input.name || path.basename(selectedPath)), workspacePath: selectedPath })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "添加本机项目失败");
  return payload;
});

app.setName("Agent Harness");
if (SMOKE_MODE && process.env.PENGUIN_DESKTOP_SMOKE_USER_DATA) {
  app.setPath("userData", process.env.PENGUIN_DESKTOP_SMOKE_USER_DATA);
}
if (process.platform === "win32") app.setAppUserModelId("com.agentharness.desktop");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function desktopPaths() {
  const appRoot = app.getAppPath();
  const userRoot = app.getPath("userData");
  const workspaceRoot = path.join(app.getPath("home"), "AgentHarnessWorkspace");
  return {
    appRoot,
    userRoot,
    dataRoot: path.join(userRoot, "data"),
    workspaceRoot,
    envFile: app.isPackaged ? path.join(userRoot, ".env") : path.join(appRoot, ".env"),
    portFile: path.join(userRoot, "server-port"),
    logFile: path.join(userRoot, "desktop.log")
  };
}

function appendLog(file, source, chunk) {
  const line = `[${new Date().toISOString()}] [${source}] ${String(chunk)}`;
  fs.appendFile(file, line, () => {});
  if (!app.isPackaged) process.stdout.write(line);
}

async function waitForPort(file, exited) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited()) throw new Error("内置服务在报告端口前已退出");
    try {
      const port = Number(fs.readFileSync(file, "utf8").trim());
      if (Number.isInteger(port) && port > 0 && port < 65536) return port;
    } catch { }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error("等待内置服务启动超时");
}

async function waitForHttp(origin, exited) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited()) throw new Error("内置服务启动过程中退出");
    try {
      const response = await fetch(`${origin}/api/capabilities`, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch { }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error("内置服务没有及时响应");
}

async function startEmbeddedServer() {
  const paths = desktopPaths();
  fs.mkdirSync(paths.userRoot, { recursive: true });
  fs.mkdirSync(paths.dataRoot, { recursive: true });
  fs.rmSync(paths.portFile, { force: true });
  desktopToken = randomBytes(32).toString("base64url");

  const serverEntry = path.join(paths.appRoot, "src", "server.mjs");
  if (!fs.existsSync(serverEntry)) throw new Error(`找不到内置服务：${serverEntry}`);

  const child = utilityProcess.fork(serverEntry, [], {
    serviceName: "agent-harness-server",
    stdio: "pipe",
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0",
      PENGUIN_HOME: paths.dataRoot,
      PENGUIN_WORKSPACE: paths.workspaceRoot,
      PENGUIN_ENV_FILE: paths.envFile,
      PENGUIN_DESKTOP_TOKEN: desktopToken,
      PENGUIN_PORT_FILE: paths.portFile
    }
  });
  serverProcess = child;
  child.stdout?.on("data", (chunk) => appendLog(paths.logFile, "server", chunk));
  child.stderr?.on("data", (chunk) => appendLog(paths.logFile, "server:error", chunk));

  let exited = false;
  child.once("exit", (code) => {
    exited = true;
    if (serverProcess === child) serverProcess = null;
    appendLog(paths.logFile, "server:exit", `code=${code ?? "unknown"}\n`);
    if (!quitting) {
      if (SMOKE_MODE) {
        process.exitCode = 1;
        app.quit();
        return;
      }
      void dialog.showMessageBox({
        type: "error",
        title: "Agent Harness",
        message: "内置服务已停止",
        detail: `退出代码：${code ?? "未知"}\n日志：${paths.logFile}`
      }).finally(() => app.quit());
    }
  });

  const port = await waitForPort(paths.portFile, () => exited);
  serverOrigin = `http://127.0.0.1:${port}`;
  await waitForHttp(serverOrigin, () => exited);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    show: false,
    icon: path.join(app.getAppPath(), "desktop", "icon.png"),
    backgroundColor: "#f8f9f5",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(app.getAppPath(), "desktop", "preload.cjs")
    }
  });
  mainWindow = win;
  win.once("ready-to-show", () => { if (!SMOKE_MODE) win.show(); });
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${serverOrigin}/`)) return { action: "allow" };
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${serverOrigin}/`)) event.preventDefault();
  });
  win.webContents.once("did-finish-load", async () => {
    if (!SMOKE_MODE) return;
    try {
      const deadline = Date.now() + START_TIMEOUT_MS;
      while (!(await win.webContents.executeJavaScript('document.body.dataset.ready === "true"'))) {
        if (Date.now() >= deadline) throw new Error("等待界面初始化超时");
        await delay(POLL_INTERVAL_MS);
      }
      await win.webContents.executeJavaScript('Promise.all([document.fonts.ready, ...document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))])');
      const image = await win.webContents.capturePage();
      const output = process.env.PENGUIN_DESKTOP_SMOKE_FILE || path.join(desktopPaths().userRoot, "desktop-smoke.png");
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, image.toPNG());
    } catch (error) {
      process.exitCode = 1;
      appendLog(desktopPaths().logFile, "smoke:error", `${error.stack || error}\n`);
    } finally { app.quit(); }
  });
  void win.loadURL(serverOrigin);
}

async function stopEmbeddedServer() {
  const child = serverProcess;
  if (!child) return;
  serverProcess = null;
  let exited = false;
  const exit = new Promise((resolve) => child.once("exit", () => { exited = true; resolve(); }));
  try {
    await fetch(`${serverOrigin}/api/desktop/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${desktopToken}` },
      signal: AbortSignal.timeout(2000)
    });
  } catch { }
  await Promise.race([exit, delay(STOP_TIMEOUT_MS)]);
  if (!exited) child.kill();
}

async function boot() {
  await startEmbeddedServer();
  createWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (mainWindow) mainWindow.show();
    else if (serverOrigin) createWindow();
  });

  app.on("before-quit", (event) => {
    quitting = true;
    if (serverProcess && !stopPromise) {
      event.preventDefault();
      stopPromise = stopEmbeddedServer().finally(() => app.quit());
    }
  });

  void app.whenReady().then(boot).catch((error) => {
    const paths = desktopPaths();
    appendLog(paths.logFile, "desktop:error", `${error.stack || error}\n`);
    if (SMOKE_MODE) {
      process.exitCode = 1;
      app.quit();
      return;
    }
    void dialog.showMessageBox({
      type: "error",
      title: "Agent Harness 启动失败",
      message: "桌面应用无法启动",
      detail: `${error.message || error}\n\n日志：${paths.logFile}`
    }).finally(() => app.quit());
  });
}
