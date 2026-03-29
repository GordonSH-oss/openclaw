/**
 * sessions.ts — Session 持久化层
 *
 * 【核心概念】Session 的"记忆"由两部分构成：
 *
 * 1. Session Store（轻量元数据）
 *    ──────────────────────────────────────────────────────────────
 *    文件：~/.mini-gateway/sessions.json
 *    内容：{ "default/main": { sessionId, model, tokens, lastChannel, ... } }
 *    特点：小体积，频繁读写（每次 turn 后更新）
 *
 * 2. Transcript（完整对话历史）
 *    ──────────────────────────────────────────────────────────────
 *    文件：~/.mini-gateway/transcripts/<sessionId>.jsonl
 *    内容：每行一条消息（user / assistant / tool）
 *    特点：只追加（append-only），通过 parentId 链构成 DAG 结构
 *
 * 【为什么用 DAG 而不是简单数组？】
 *
 *    数组结构（危险）：        DAG 结构（安全）：
 *    [msg1, msg2, msg3]        msg1 ← msg2 ← msg3
 *    压缩时直接截断历史         压缩时只需替换头节点，不破坏链
 *
 * 【写 transcript 的正确姿势】
 *    ✅ 通过 appendTranscriptMessage() 写
 *    ❌ 不要直接操作 JSONL 文件（会丢失 parentId）
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import os from "node:os";

// ─── 配置路径 ──────────────────────────────────────────────────────────────────

const GATEWAY_DATA_DIR = path.join(os.homedir(), ".mini-gateway");
const SESSION_STORE_PATH = path.join(GATEWAY_DATA_DIR, "sessions.json");
const TRANSCRIPTS_DIR = path.join(GATEWAY_DATA_DIR, "transcripts");

// ─── Session Store 类型 ───────────────────────────────────────────────────────

/**
 * 单个 session 的元数据
 *
 * 这是"轻量级"的数据，读写频率高，保持小体积。
 * 完整的对话历史在 transcript 文件里，不在这里。
 */
export type SessionEntry = {
  /** session 唯一 ID（UUID），用于定位 transcript 文件 */
  sessionId: string;
  /** 创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 当前状态 */
  status: "idle" | "running" | "error";
  /** 使用的 model provider */
  provider?: string;
  /** 使用的 model */
  model?: string;
  /** 累计输入 token 数 */
  inputTokens: number;
  /** 累计输出 token 数 */
  outputTokens: number;
  /** 最后一次收到消息的 channel */
  lastChannel?: string;
  /** 最后一次收到消息的发送方 */
  lastTo?: string;
  /** 最后一次 run 的开始时间 */
  startedAt?: number;
  /** 最后一次 run 的结束时间 */
  endedAt?: number;
};

/** Session store 的完整结构：sessionKey → SessionEntry */
export type SessionStore = Record<string, SessionEntry>;

// ─── Transcript 类型 ───────────────────────────────────────────────────────────

/**
 * Transcript 中的单条消息
 *
 * 这是 DAG 节点，每个节点都指向父节点（parentId）。
 * 通过 parentId 链，可以恢复完整的对话历史，也可以安全地压缩历史。
 */
export type TranscriptMessage = {
  /** 消息唯一 ID */
  id: string;
  /** 父消息 ID（第一条消息没有父消息） */
  parentId?: string;
  /** 消息角色 */
  role: "user" | "assistant" | "tool" | "system";
  /** 消息内容 */
  content: string | TranscriptContentPart[];
  /** 消息时间戳 */
  timestamp: number;
  /** 附加元数据（只有 assistant 消息才有） */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** 工具名称（只有 tool 消息才有） */
  toolName?: string;
  /** 模型名称（只有 assistant 消息才有） */
  model?: string;
};

export type TranscriptContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolName: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string };

// ─── Session Store 操作 ────────────────────────────────────────────────────────

/**
 * 确保数据目录存在
 */
async function ensureDataDirs(): Promise<void> {
  await fs.mkdir(GATEWAY_DATA_DIR, { recursive: true });
  await fs.mkdir(TRANSCRIPTS_DIR, { recursive: true });
}

/**
 * 读取完整的 session store
 */
export async function loadSessionStore(): Promise<SessionStore> {
  try {
    const raw = await fs.readFile(SESSION_STORE_PATH, "utf-8");
    return JSON.parse(raw) as SessionStore;
  } catch {
    return {};
  }
}

/**
 * 获取或创建一个 session entry
 *
 * 如果 session 不存在，自动创建一个新的。
 */
export async function getOrCreateSession(
  sessionKey: string,
  initial?: Partial<SessionEntry>,
): Promise<{ entry: SessionEntry; isNew: boolean }> {
  const store = await loadSessionStore();
  const existing = store[sessionKey];

  if (existing) {
    return { entry: existing, isNew: false };
  }

  const entry: SessionEntry = {
    sessionId: randomUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
    inputTokens: 0,
    outputTokens: 0,
    ...initial,
  };

  await updateSessionEntry(sessionKey, entry);
  return { entry, isNew: true };
}

/**
 * 更新 session entry（原子性写入，防止并发写入数据丢失）
 *
 * 使用"读取-修改-写入"模式，通过闭包让调用方决定如何修改：
 *
 *   await updateSessionEntry(sessionKey, (current) => ({
 *     ...current,
 *     status: "running",
 *     startedAt: Date.now(),
 *   }));
 *
 * 注意：这是简化版本。生产系统需要真正的文件锁（如 proper-lockfile），
 * 防止多个并发请求同时修改同一个文件。
 */
export async function updateSessionEntry(
  sessionKey: string,
  patchOrEntry: Partial<SessionEntry> | SessionEntry | ((current: SessionEntry | undefined) => SessionEntry),
): Promise<SessionEntry> {
  await ensureDataDirs();
  const store = await loadSessionStore();
  const current = store[sessionKey];

  let next: SessionEntry;
  if (typeof patchOrEntry === "function") {
    next = patchOrEntry(current);
  } else if (current) {
    next = { ...current, ...patchOrEntry, updatedAt: Date.now() };
  } else {
    next = {
      sessionId: randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "idle",
      inputTokens: 0,
      outputTokens: 0,
      ...(patchOrEntry as Partial<SessionEntry>),
    };
  }

  store[sessionKey] = next;
  await fs.writeFile(SESSION_STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
  return next;
}

/**
 * 列出所有 sessions（可选：按 updatedAt 排序）
 */
export async function listSessions(): Promise<Array<{ key: string; entry: SessionEntry }>> {
  const store = await loadSessionStore();
  return Object.entries(store)
    .map(([key, entry]) => ({ key, entry }))
    .sort((a, b) => b.entry.updatedAt - a.entry.updatedAt);
}

/**
 * 删除一个 session（同时删除对应的 transcript 文件）
 */
export async function deleteSession(sessionKey: string): Promise<void> {
  const store = await loadSessionStore();
  const entry = store[sessionKey];

  if (entry?.sessionId) {
    const transcriptPath = getTranscriptPath(entry.sessionId);
    await fs.rm(transcriptPath, { force: true });
  }

  delete store[sessionKey];
  await fs.writeFile(SESSION_STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

// ─── Transcript 操作 ───────────────────────────────────────────────────────────

/**
 * 获取 transcript 文件路径
 */
export function getTranscriptPath(sessionId: string): string {
  return path.join(TRANSCRIPTS_DIR, `${sessionId}.jsonl`);
}

/**
 * 读取完整的 transcript（解析 JSONL）
 */
export async function loadTranscript(sessionId: string): Promise<TranscriptMessage[]> {
  const filePath = getTranscriptPath(sessionId);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as TranscriptMessage);
  } catch {
    return [];
  }
}

/**
 * 追加一条消息到 transcript
 *
 * 【DAG 写入规则】：
 * 1. 读取当前 transcript，找到最后一条消息的 id 作为 parentId
 * 2. 生成新消息的 id
 * 3. 追加到文件末尾（append-only）
 *
 * 注意：不要直接 append 没有 parentId 的消息！
 * 这会导致 DAG 链断裂，历史压缩（compaction）时会丢失数据。
 */
export async function appendTranscriptMessage(
  sessionId: string,
  message: Omit<TranscriptMessage, "id" | "parentId">,
): Promise<TranscriptMessage> {
  await ensureDataDirs();
  const filePath = getTranscriptPath(sessionId);

  // 找到最后一条消息的 id，作为新消息的 parentId
  let parentId: string | undefined;
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      const lastMsg = JSON.parse(lastLine!) as TranscriptMessage;
      parentId = lastMsg.id;
    }
  } catch {
    // 文件不存在，这是第一条消息，parentId = undefined
  }

  const newMessage: TranscriptMessage = {
    id: randomUUID(),
    parentId,
    ...message,
  };

  // Append-only：只追加，不覆盖
  await fs.appendFile(filePath, JSON.stringify(newMessage) + "\n", "utf-8");
  return newMessage;
}

/**
 * 便捷函数：追加一个完整的 turn（用户消息 + 助手回复）
 */
export async function appendTurn(params: {
  sessionId: string;
  userMessage: string;
  assistantReply: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
}): Promise<void> {
  // 先写用户消息
  await appendTranscriptMessage(params.sessionId, {
    role: "user",
    content: params.userMessage,
    timestamp: Date.now(),
  });

  // 再写助手回复
  await appendTranscriptMessage(params.sessionId, {
    role: "assistant",
    content: [{ type: "text", text: params.assistantReply }],
    timestamp: Date.now(),
    model: params.model,
    usage: params.usage,
  });
}

// ─── Transcript 广播 ───────────────────────────────────────────────────────────

type TranscriptUpdateListener = (params: {
  sessionId: string;
  sessionKey: string;
  message: TranscriptMessage;
}) => void;

const transcriptUpdateListeners = new Set<TranscriptUpdateListener>();

/**
 * 订阅 transcript 更新事件
 * Gateway 通过这个机制把新消息实时推送给连接的客户端
 */
export function onTranscriptUpdate(listener: TranscriptUpdateListener): () => void {
  transcriptUpdateListeners.add(listener);
  return () => transcriptUpdateListeners.delete(listener);
}

/**
 * 触发 transcript 更新事件（内部使用）
 */
export function emitTranscriptUpdate(params: {
  sessionId: string;
  sessionKey: string;
  message: TranscriptMessage;
}): void {
  for (const listener of transcriptUpdateListeners) {
    try {
      listener(params);
    } catch {
      // 忽略单个 listener 的错误
    }
  }
}
