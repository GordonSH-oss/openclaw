import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await ensureParentDir(filePath);
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await fs.rename(tempPath, filePath);
}

export async function writeTextAtomic(filePath: string, value: string): Promise<void> {
  await ensureParentDir(filePath);
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, value, "utf-8");
  await fs.rename(tempPath, filePath);
}

export async function appendJsonlAtomic(filePath: string, line: unknown): Promise<void> {
  await ensureParentDir(filePath);
  await fs.appendFile(filePath, `${JSON.stringify(line)}\n`, "utf-8");
}

export async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function readJsonlSafe<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}
