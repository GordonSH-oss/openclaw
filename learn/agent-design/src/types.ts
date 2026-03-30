export type ThinkingLevel = "off" | "low" | "medium" | "high";
export type VerboseLevel = "off" | "on" | "full";
export type RunnerBackend = "embedded" | "cli";

export type ToolContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolUseId: string; toolName: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string };

/**
 * learning 版 transcript 仍然保留 append-only 消息模型。
 *
 * 这很重要，因为 OpenClaw 的“记忆”并不是一个单独的大对象：
 * - 会话内短期记忆主要依赖 transcript
 * - 会话外长期记忆则回写到 workspace memory
 */
export type LearningTranscriptMessage = {
  id: string;
  parentId?: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string | ToolContentPart[];
  timestamp: number;
  model?: string;
  toolName?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

export type SkillSnapshotEntry = {
  name: string;
  filePath: string;
  source: "workspace" | "repo" | "custom";
  summary: string;
};

export type SkillSnapshot = {
  version: string;
  roots: string[];
  entries: SkillSnapshotEntry[];
  prompt: string;
};

export type SkillSnapshotSummary = Pick<SkillSnapshot, "version" | "roots"> & {
  skillNames: string[];
};

export type AuthProfile = {
  id: string;
  provider: string;
  type: "oauth" | "token" | "api_key";
  label: string;
};

export type AuthProfileUsage = {
  lastUsed?: number;
  cooldownUntil?: number;
  lastFailureReason?: "timeout" | "rate_limit" | "auth";
};

export type AuthProfileOrderResult = {
  orderedProfileIds: string[];
  cooledDownProfileIds: string[];
};

export type ModelCandidate = {
  provider: string;
  model: string;
  reason: "primary" | "fallback";
};

export type AgentAcceptedResult = {
  runId: string;
  status: "accepted";
  acceptedAt: number;
};

export type AgentTerminalStatus = "ok" | "error" | "cancelled";

export type AgentTerminalResult = {
  runId: string;
  status: AgentTerminalStatus;
  summary: string;
  reply?: string;
  selectedModel?: string;
  selectedProvider?: string;
  attempts: Array<{
    provider: string;
    model: string;
    ok: boolean;
    reason?: string;
  }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  skillSnapshot?: SkillSnapshotSummary;
};

/**
 * Gateway 和 agent runtime 之间看的不是“内部函数调用”，而是一条事件流。
 *
 * 所以这里把 delta、tool、memory、transcript.message 都定义成显式事件，
 * 方便学习：
 * - 哪些内容适合实时推送给控制面
 * - 哪些内容应该持久化到 transcript 或 memory
 */
export type LearningAgentEvent =
  | { type: "status"; runId: string; phase: "started" | "attempt" | "completed" | "failed" }
  | { type: "delta"; runId: string; sessionKey: string; text: string; delta: string }
  | {
      type: "tool";
      runId: string;
      stage: "start" | "result";
      toolName: string;
      input?: unknown;
      output?: string;
    }
  | {
      type: "memory";
      runId: string;
      action: "write" | "flush";
      path: string;
      note: string;
    }
  | {
      type: "transcript.message";
      runId: string;
      sessionKey: string;
      message: LearningTranscriptMessage;
    };

export type LearningAgentCommandParams = {
  runId: string;
  message: string;
  sessionKey: string;
  sessionId?: string;
  dataDir?: string;
  workspaceDir?: string;
  backend?: RunnerBackend;
  provider?: string;
  model?: string;
  timeoutMs?: number;
  thinkingLevel?: ThinkingLevel;
  verboseLevel?: VerboseLevel;
  preferredAuthProfile?: string;
  skillRoots?: string[];
  signal?: AbortSignal;
  onEvent?: (event: LearningAgentEvent) => void;
};

export type LearningAgentResult = AgentTerminalResult & {
  sessionId: string;
  transcriptPath: string;
};

export type LearningAgentRunHandle = {
  runId: string;
  accepted: AgentAcceptedResult;
  completion: Promise<LearningAgentResult>;
};

export type LearningAgentSessionEntry = {
  sessionId: string;
  sessionKey: string;
  transcriptPath: string;
  createdAt: number;
  updatedAt: number;
  status: "idle" | "running" | "error";
  model?: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
};
