import fs from "node:fs/promises";
import path from "node:path";

/**
 * learning 版长期记忆的 source of truth 是 workspace 里的 Markdown 文件。
 *
 * 这里故意复刻 OpenClaw 的两层结构：
 * - `MEMORY.md` / `memory.md`: curated long-term memory
 * - `memory/YYYY-MM-DD.md`: append-only daily memory
 */

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveMemoryWorkspaceDir(workspaceDir?: string): string {
  return path.resolve(workspaceDir ?? process.cwd());
}

export function resolveCuratedMemoryPath(workspaceDir?: string): string {
  return path.join(resolveMemoryWorkspaceDir(workspaceDir), "MEMORY.md");
}

export function resolveAltCuratedMemoryPath(workspaceDir?: string): string {
  return path.join(resolveMemoryWorkspaceDir(workspaceDir), "memory.md");
}

export function resolveDailyMemoryDir(workspaceDir?: string): string {
  return path.join(resolveMemoryWorkspaceDir(workspaceDir), "memory");
}

export function resolveDailyMemoryPath(params: {
  workspaceDir?: string;
  now?: Date;
}): string {
  const now = params.now ?? new Date();
  const stamp = now.toISOString().slice(0, 10);
  return path.join(resolveDailyMemoryDir(params.workspaceDir), `${stamp}.md`);
}

export async function ensureWorkspaceMemoryDirs(workspaceDir?: string): Promise<void> {
  await fs.mkdir(resolveDailyMemoryDir(workspaceDir), { recursive: true });
}

async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function loadBootstrapMemory(params: {
  workspaceDir?: string;
}): Promise<{
  loadedPaths: string[];
  combinedText: string;
}> {
  // curated memory 允许两种命名，方便学习项目在不同仓库下试验。
  const curated = resolveCuratedMemoryPath(params.workspaceDir);
  const alt = resolveAltCuratedMemoryPath(params.workspaceDir);
  const candidates = [curated, alt];
  const loadedPaths: string[] = [];
  const parts: string[] = [];
  const seen = new Set<string>();

  for (const filePath of candidates) {
    const content = await tryReadFile(filePath);
    if (!content?.trim()) {
      continue;
    }
    let realPath = filePath;
    try {
      realPath = await fs.realpath(filePath);
    } catch {
      // Keep the original path if the file disappears between read and realpath.
    }
    if (seen.has(realPath)) {
      continue;
    }
    seen.add(realPath);
    loadedPaths.push(filePath);
    parts.push(content.trim());
  }

  return {
    loadedPaths,
    combinedText: parts.join("\n\n"),
  };
}

export async function listWorkspaceMemoryFiles(params: {
  workspaceDir?: string;
}): Promise<string[]> {
  const workspaceDir = resolveMemoryWorkspaceDir(params.workspaceDir);
  const result: string[] = [];

  const addIfPresent = async (filePath: string) => {
    const content = await tryReadFile(filePath);
    if (content !== null) {
      result.push(filePath);
    }
  };

  await addIfPresent(resolveCuratedMemoryPath(workspaceDir));
  await addIfPresent(resolveAltCuratedMemoryPath(workspaceDir));

  try {
    const dailyDir = resolveDailyMemoryDir(workspaceDir);
    const entries = await fs.readdir(dailyDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }
      result.push(path.join(dailyDir, entry.name));
    }
  } catch {
    // Missing daily memory dir is fine.
  }

  return result.sort();
}

export async function readWorkspaceMemoryFile(params: {
  workspaceDir?: string;
  target?: string;
}): Promise<{ path: string; text: string }> {
  const workspaceDir = resolveMemoryWorkspaceDir(params.workspaceDir);
  const target = (params.target ?? "MEMORY.md").trim() || "MEMORY.md";
  const resolved = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(workspaceDir, target);

  if (!isPathInside(workspaceDir, resolved)) {
    // memory tools 只能访问当前 workspace，避免学习版把“长期记忆”误做成任意文件读取器。
    throw new Error("memory_get 只能读取当前 workspace 内的记忆文件");
  }

  const text = await tryReadFile(resolved);
  if (text === null) {
    return { path: resolved, text: "" };
  }
  return { path: resolved, text };
}

export async function appendDailyMemoryEntry(params: {
  workspaceDir?: string;
  note: string;
  source: "manual" | "flush";
  marker?: string;
  now?: Date;
}): Promise<{ path: string; text: string }> {
  await ensureWorkspaceMemoryDirs(params.workspaceDir);
  const filePath = resolveDailyMemoryPath({
    workspaceDir: params.workspaceDir,
    now: params.now,
  });
  const now = params.now ?? new Date();
  const time = now.toISOString();
  const heading = `# ${time.slice(0, 10)}`;
  const body = [
    params.marker ? `<!-- ${params.marker} -->` : "",
    `## ${params.source === "manual" ? "Manual memory write" : "Pre-compaction memory flush"} @ ${time}`,
    params.note.trim(),
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const existing = await tryReadFile(filePath);
  // flush 会带 marker，保证同一批上下文不会被重复写回 daily memory。
  if (params.marker && existing?.includes(`<!-- ${params.marker} -->`)) {
    return { path: filePath, text: existing };
  }

  if (existing === null) {
    await fs.writeFile(filePath, `${heading}\n\n${body}`, "utf-8");
  } else {
    await fs.appendFile(filePath, `\n${body}`, "utf-8");
  }

  return {
    path: filePath,
    text: (await tryReadFile(filePath)) ?? "",
  };
}
