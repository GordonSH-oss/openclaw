import fs from "node:fs/promises";
import path from "node:path";
import type { SkillSnapshot, SkillSnapshotEntry } from "../types.js";

// 这里的 skill loader 故意做得很“小”，但保留了最值得学习的两个点：
//
// 1. skill 是从 workspace / 指定 roots 动态发现的，而不是硬编码进 runner
// 2. 发现 skill 时必须做路径 containment 检查，防止越界读取

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function collectSkillEntries(root: string, source: SkillSnapshotEntry["source"]) {
  // 一个子目录只要有 SKILL.md，就被视为一个可供 prompt 注入的 skill。
  const entries = await fs.readdir(root, { withFileTypes: true });
  const skills: SkillSnapshotEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillFile = path.join(root, entry.name, "SKILL.md");
    if (!(await fileExists(skillFile))) {
      continue;
    }

    // realpath + containment 是这层最重要的安全点。
    // 学习时要记住：只看字符串前缀是不够的，symlink 可能绕过简单判断。
    const realRoot = await fs.realpath(root);
    const realSkillFile = await fs.realpath(skillFile);
    if (!isPathInside(realRoot, realSkillFile)) {
      continue;
    }
    const raw = await fs.readFile(skillFile, "utf-8");
    const summary = raw
      .split("\n")
      .map((line: string) => line.trim())
      .find((line: string) => line && !line.startsWith("#") && !line.startsWith("---"));
    skills.push({
      name: entry.name,
      filePath: skillFile,
      source,
      summary: summary ?? "No summary available.",
    });
  }
  return skills;
}

/**
 * 生成本次 run 的 skill snapshot。
 *
 * “snapshot” 这个词很重要，它强调：
 * runner 消费的不是一个会在执行中变化的技能目录，而是执行开始时拍下来的技能视图。
 */
export async function buildWorkspaceSkillSnapshot(params: {
  workspaceDir?: string;
  skillRoots?: string[];
}): Promise<SkillSnapshot> {
  const roots = new Set<string>();
  if (params.workspaceDir) {
    // 默认把当前 workspace 下的 `.agents/skills` 当作第一技能源。
    roots.add(path.join(params.workspaceDir, ".agents", "skills"));
  }
  for (const root of params.skillRoots ?? []) {
    roots.add(root);
  }

  const collected: SkillSnapshotEntry[] = [];
  for (const root of roots) {
    try {
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) {
        continue;
      }
      const source: SkillSnapshotEntry["source"] =
        params.workspaceDir && root.startsWith(params.workspaceDir) ? "workspace" : "custom";
      const items = await collectSkillEntries(root, source);
      collected.push(...items);
    } catch {
      // 学习项目里允许 root 不存在，这样便于在空仓库里直接跑起来。
    }
  }

  const orderedCollected = collected.toSorted((a, b) => a.name.localeCompare(b.name));

  // prompt 字段让你可以很直观地看到：
  // “加载出的技能最终是如何被压缩成一段可注入模型上下文的文本”。
  const prompt =
    orderedCollected.length === 0
      ? "No workspace skills are active for this run."
      : [
          "Workspace skills available to this run:",
          ...orderedCollected.map(
            (entry) => `- ${entry.name}: ${entry.summary} (${entry.filePath})`,
          ),
        ].join("\n");

  return {
    version: `skills:${orderedCollected.length}`,
    roots: Array.from(roots),
    entries: orderedCollected,
    prompt,
  };
}
