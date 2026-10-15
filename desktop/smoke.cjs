const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const electron = require("electron");
const packed = process.argv[2] === "--packed";
const outputArg = packed ? process.argv[3] : process.argv[2];
const output = path.resolve(outputArg || path.join("desktop-dist", packed ? "desktop-packed-smoke.png" : "desktop-smoke.png"));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.rmSync(output, { force: true });

const packedExecutable = process.platform === "win32"
  ? path.join("desktop-dist", "win-unpacked", "Agent Harness.exe")
  : path.join("desktop-dist", "linux-unpacked", "agent-harness");
const executable = packed ? path.resolve(packedExecutable) : electron;
const args = packed ? [] : ["."];
const smokeUserData = fs.mkdtempSync(path.join(os.tmpdir(), "agent-harness-smoke-"));

const child = spawn(executable, args, {
  cwd: path.resolve(__dirname, ".."),
  env: {
    ...process.env,
    PENGUIN_DESKTOP_SMOKE: "1",
    PENGUIN_DESKTOP_SMOKE_FILE: output,
    PENGUIN_DESKTOP_SMOKE_USER_DATA: smokeUserData
  },
  stdio: "inherit",
  windowsHide: true
});

const timer = setTimeout(() => {
  child.kill();
  console.error("Desktop smoke test timed out");
  process.exitCode = 1;
}, 45_000);

child.once("exit", (code) => {
  clearTimeout(timer);
  fs.rmSync(smokeUserData, { recursive: true, force: true });
  if (code !== 0 || !fs.existsSync(output) || fs.statSync(output).size === 0) {
    console.error(`Desktop smoke test failed (exit ${code}); screenshot: ${output}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Desktop smoke test passed: ${output}`);
});
