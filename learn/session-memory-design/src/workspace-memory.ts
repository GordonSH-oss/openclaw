import fs from "node:fs/promises";
import path from "node:path";

export function resolveLearningMemoryWorkspaceDir(workspaceDir?: string): string {
  return path.resolve(workspaceDir ?? process.cwd());
}

export function resolveLearningCuratedMemoryPath(workspaceDir?: string): string {
  return path.join(resolveLearningMemoryWorkspaceDir(workspaceDir), "MEMORY.md");
}

export function resolveLearningAltCuratedMemoryPath(workspaceDir?: string): string {
  return path.join(resolveLearningMemoryWorkspaceDir(workspaceDir), "memory.md");
}

export function resolveLearningDailyMemoryDir(workspaceDir?: string): string {
  return path.join(resolveLearningMemoryWorkspaceDir(workspaceDir), "memory");
}

export function resolveLearningDailyMemoryPath(params: {
  workspaceDir?: string;
  now?: Date;
}): string {
  const stamp = (params.now ?? new Date()).toISOString().slice(0, 10);
  return path.join(resolveLearningDailyMemoryDir(params.workspaceDir), `${stamp}.md`);
}

async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function loadLearningBootstrapMemory(params: {
  workspaceDir?: string;
}): Promise<{ loadedPaths: string[]; combinedText: string }> {
  const files = [
    resolveLearningCuratedMemoryPath(params.workspaceDir),
    resolveLearningAltCuratedMemoryPath(params.workspaceDir),
  ];
  const parts: string[] = [];
  const loadedPaths: string[] = [];
  for (const filePath of files) {
    const text = await tryReadFile(filePath);
    if (!text?.trim()) {
      continue;
    }
    parts.push(text.trim());
    loadedPaths.push(filePath);
  }
  return {
    loadedPaths,
    combinedText: parts.join("\n\n"),
  };
}

export async function listLearningMemoryFiles(params: {
  workspaceDir?: string;
}): Promise<string[]> {
  const workspaceDir = resolveLearningMemoryWorkspaceDir(params.workspaceDir);
  const result: string[] = [];
  for (const filePath of [
    resolveLearningCuratedMemoryPath(workspaceDir),
    resolveLearningAltCuratedMemoryPath(workspaceDir),
  ]) {
    if ((await tryReadFile(filePath)) !== null) {
      result.push(filePath);
    }
  }
  try {
    const entries = await fs.readdir(resolveLearningDailyMemoryDir(workspaceDir), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        result.push(path.join(resolveLearningDailyMemoryDir(workspaceDir), entry.name));
      }
    }
  } catch {
    // Missing daily memory dir is fine.
  }
  return result.toSorted();
}

export async function readLearningMemoryFile(params: {
  workspaceDir?: string;
  target?: string;
}): Promise<{ path: string; text: string }> {
  const workspaceDir = resolveLearningMemoryWorkspaceDir(params.workspaceDir);
  const target = (params.target ?? "MEMORY.md").trim() || "MEMORY.md";
  const resolved = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(workspaceDir, target);
  if (!isPathInside(workspaceDir, resolved)) {
    throw new Error("memory_get 只能读取当前 workspace 内的记忆文件");
  }
  const text = await tryReadFile(resolved);
  return {
    path: resolved,
    text: text ?? "",
  };
}

export async function appendLearningDailyMemoryEntry(params: {
  workspaceDir?: string;
  note: string;
  source: "manual" | "flush";
  marker?: string;
  now?: Date;
}): Promise<{ path: string; text: string }> {
  const filePath = resolveLearningDailyMemoryPath({
    workspaceDir: params.workspaceDir,
    now: params.now,
  });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const now = params.now ?? new Date();
  const time = now.toISOString();
  const existing = await tryReadFile(filePath);
  if (params.marker && existing?.includes(`<!-- ${params.marker} -->`)) {
    return { path: filePath, text: existing };
  }
  const body = [
    params.marker ? `<!-- ${params.marker} -->` : "",
    `## ${params.source === "manual" ? "Manual memory write" : "Pre-compaction memory flush"} @ ${time}`,
    params.note.trim(),
    "",
  ]
    .filter(Boolean)
    .join("\n");
  if (existing === null) {
    await fs.writeFile(filePath, `# ${time.slice(0, 10)}\n\n${body}`, "utf-8");
  } else {
    await fs.appendFile(filePath, `\n${body}`, "utf-8");
  }
  return {
    path: filePath,
    text: (await tryReadFile(filePath)) ?? "",
  };
}
