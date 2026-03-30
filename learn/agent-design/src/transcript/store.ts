import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { LearningTranscriptMessage } from "../types.js";

// 这层只负责 transcript 的持久化，不负责 session metadata。
// 学习时可以把它看成真实系统里“append-only 对话历史层”的最小抽象。

export function resolveLearningAgentDataDir(dataDir?: string): string {
  return dataDir ?? path.resolve(process.cwd(), ".learning-agent-data");
}

export function getTranscriptDir(dataDir?: string): string {
  return path.join(resolveLearningAgentDataDir(dataDir), "transcripts");
}

export function getTranscriptPath(sessionId: string, dataDir?: string): string {
  return path.join(getTranscriptDir(dataDir), `${sessionId}.jsonl`);
}

export async function ensureTranscriptDir(dataDir?: string): Promise<void> {
  await fs.mkdir(getTranscriptDir(dataDir), { recursive: true });
}

export async function loadLearningTranscript(
  sessionId: string,
  dataDir?: string,
): Promise<LearningTranscriptMessage[]> {
  const transcriptPath = getTranscriptPath(sessionId, dataDir);
  try {
    // learning 版为了易读，直接每次整文件读回来再解析 JSONL。
    // 真实系统在规模更大时会更强调增量读取、索引和并发安全。
    const raw = await fs.readFile(transcriptPath, "utf-8");
    return raw
      .split("\n")
      .filter((line: string) => line.trim())
      .map((line: string) => JSON.parse(line) as LearningTranscriptMessage);
  } catch {
    return [];
  }
}

export async function appendTranscriptMessage(params: {
  sessionId: string;
  dataDir?: string;
  message: Omit<LearningTranscriptMessage, "id" | "parentId">;
}): Promise<LearningTranscriptMessage> {
  await ensureTranscriptDir(params.dataDir);
  const transcript = await loadLearningTranscript(params.sessionId, params.dataDir);

  // 新消息总是挂到“当前最后一条消息”之后。
  // 这样虽然存储格式仍然是 JSONL，但逻辑结构已经接近一个线性 DAG。
  const parentId = transcript.at(-1)?.id;
  const next: LearningTranscriptMessage = {
    id: randomUUID(),
    parentId,
    ...params.message,
  };

  // append-only 是 transcript 层最值得记住的设计点：
  // session metadata 可以被覆盖更新，但完整历史通常更适合只追加。
  await fs.appendFile(
    getTranscriptPath(params.sessionId, params.dataDir),
    JSON.stringify(next) + "\n",
    "utf-8",
  );
  return next;
}
