import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_MEMORY = "# Memory\n\nDurable user preferences and reusable facts.\n";
const DEFAULT_SKILL = `---
name: workspace-basics
description: Work carefully in the local workspace and verify changes.
---

# Workspace Basics

- Read relevant files before editing.
- Keep changes scoped to the request.
- Verify created or modified files before reporting completion.
`;

export class KnowledgeBase {
  constructor(dataRoot) {
    this.memoryDir = path.join(dataRoot, "memory");
    this.skillsDir = path.join(dataRoot, "skills");
    this.memoryFile = path.join(this.memoryDir, "MEMORY.md");
  }

  async init() {
    await fs.mkdir(this.memoryDir, { recursive: true });
    await fs.mkdir(path.join(this.skillsDir, "workspace-basics"), { recursive: true });
    await ensureFile(this.memoryFile, DEFAULT_MEMORY);
    await ensureFile(path.join(this.skillsDir, "workspace-basics", "SKILL.md"), DEFAULT_SKILL);
  }

  async memory() {
    return await fs.readFile(this.memoryFile, "utf8");
  }

  async writeMemory(content) {
    const staging = `${this.memoryFile}.tmp`;
    await fs.writeFile(staging, normalizeText(content), "utf8");
    await fs.rename(staging, this.memoryFile);
    return "memory updated";
  }

  async listSkills() {
    const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(this.skillsDir, entry.name, "SKILL.md");
      try {
        const content = await fs.readFile(file, "utf8");
        const description = /^description:\s*(.+)$/m.exec(content)?.[1]?.trim() || "";
        skills.push({ name: entry.name, description });
      } catch { }
    }
    return skills;
  }

  async readSkill(name) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("invalid skill name");
    return await fs.readFile(path.join(this.skillsDir, name, "SKILL.md"), "utf8");
  }

  async systemPrompt(memoryContext = "") {
    const memory = await this.memory();
    const skills = await this.listSkills();
    return [
      "You are a local coding and automation agent. Use tools when they are needed and explain final outcomes plainly.",
      "All file and command tools are constrained to the configured workspace.",
      "Use read_memory before relying on durable facts. Use write_memory only for stable, reusable facts, never secrets.",
      `Available skills:\n${skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n") || "- none"}`,
      `Memory index:\n${memory.slice(0, 12000)}`,
      memoryContext ? `Retrieved memory for this task:\n${memoryContext}` : "Retrieved memory for this task:\n- none"
    ].join("\n\n");
  }
}

async function ensureFile(file, content) {
  try { await fs.access(file); } catch { await fs.writeFile(file, content, "utf8"); }
}

function normalizeText(content) {
  const value = String(content || "").replace(/\r\n/g, "\n").trimEnd();
  return `${value}\n`;
}
