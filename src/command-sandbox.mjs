import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export class CommandSandbox {
  constructor({ workspaceRoot, skillsRoot = "", network = "none", distro = process.env.SANDBOX_WSL_DISTRO || "Ubuntu" } = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.workspaceLinux = process.platform === "win32" ? windowsPathToWsl(this.workspaceRoot) : this.workspaceRoot;
    this.skillsRoot = skillsRoot ? path.resolve(skillsRoot) : "";
    this.skillsLinux = this.skillsRoot ? (process.platform === "win32" ? windowsPathToWsl(this.skillsRoot) : this.skillsRoot) : "";
    this.network = network === "allow" ? "allow" : "none";
    this.distro = distro;
    this.backend = process.platform === "win32" ? "wsl2-bubblewrap" : "bubblewrap";
    this.available = false;
    this.error = "not initialized";
  }

  async init() {
    try {
      const probe = this.#launch(this.#profile("true"));
      const result = spawnSync(probe.executable, probe.argv, { timeout: 15000, stdio: "ignore", windowsHide: true });
      if (result.status !== 0) throw new Error(`bubblewrap isolation probe failed (exit ${result.status})`);
      this.available = true;
      this.error = "";
    } catch (error) {
      this.available = false;
      this.error = String(error?.message || error);
    }
    return this.status();
  }

  status() {
    return {
      available: this.available, backend: this.backend,
      enforcement: this.available ? "mount+pid+network namespaces" : "fail-closed",
      filesystem: this.available ? "workspace-only" : "blocked",
      readScope: this.available ? `/workspace${this.skillsLinux ? " and read-only /skills" : ""} plus Linux runtime` : "none",
      network: this.network, shell: "bash", distro: this.distro, error: this.error
    };
  }

  #launch(argv) {
    return process.platform === "win32"
      ? { executable: "wsl.exe", argv: ["-d", this.distro, "--", ...argv] }
      : { executable: argv[0], argv: argv.slice(1) };
  }

  #profile(command) {
    return [
      "bwrap", "--die-with-parent", "--new-session", "--unshare-pid", "--unshare-uts", "--unshare-ipc",
      ...(this.network === "none" ? ["--unshare-net"] : []), "--clearenv",
      "--ro-bind", "/usr", "/usr", "--ro-bind", "/bin", "/bin",
      "--ro-bind", "/lib", "/lib", "--ro-bind-try", "/lib64", "/lib64",
      "--dir", "/etc", "--ro-bind-try", "/etc/ssl", "/etc/ssl",
      "--ro-bind-try", "/etc/resolv.conf", "/etc/resolv.conf",
      "--ro-bind-try", "/etc/hosts", "/etc/hosts",
      "--ro-bind-try", "/etc/nsswitch.conf", "/etc/nsswitch.conf",
      "--ro-bind-try", "/etc/ld.so.cache", "/etc/ld.so.cache",
      "--dev", "/dev", "--proc", "/proc",
      "--tmpfs", "/tmp", "--dir", "/tmp/home",
      "--setenv", "HOME", "/tmp/home", "--setenv", "TMPDIR", "/tmp",
      "--setenv", "LANG", "C.UTF-8", "--setenv", "PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "--bind", this.workspaceLinux, "/workspace",
      ...(this.skillsLinux ? ["--ro-bind", this.skillsLinux, "/skills"] : []),
      "--chdir", "/workspace",
      "/bin/bash", "--noprofile", "--norc", "-c", String(command || "")
    ];
  }

  invocation(command) {
    if (!this.available) throw new Error(`command sandbox unavailable: ${this.error}; refusing to execute on the host`);
    return this.#launch(this.#profile(command));
  }

  async run(command, signal) {
    const invocation = this.invocation(command);
    return await new Promise((resolve, reject) => {
      const child = spawn(invocation.executable, invocation.argv, { cwd: this.workspaceRoot, signal, windowsHide: true });
      let output = "";
      const append = (chunk) => { output += chunk; if (output.length > 1024 * 1024) output = output.slice(-1024 * 1024); };
      child.stdout.on("data", append); child.stderr.on("data", append);
      child.on("error", reject);
      child.on("close", (code) => resolve(`${output}\n[exit ${code}]`.trim()));
    });
  }
}

export function windowsPathToWsl(value) {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(String(value));
  if (!match) throw new Error(`cannot map Windows path into WSL: ${value}`);
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}
