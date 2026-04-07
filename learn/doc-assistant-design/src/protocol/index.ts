export type DocAssistantRequest = {
  id: string;
  method: string;
  params?: unknown;
};

export type DocAssistantErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "TIMEOUT";

export type DocAssistantError = {
  code: DocAssistantErrorCode;
  message: string;
};

export type DocAssistantResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: DocAssistantError;
  meta?: Record<string, unknown>;
};

export type DocAssistantEvent = {
  event: string;
  data: unknown;
};

export type ConnectParams = {
  token?: string;
  clientId?: string;
};

export type ConnectedClient = {
  connId: string;
  authenticated: boolean;
  scopes: string[];
  connect: ConnectParams;
};

export type DocAssistantMode = "extractive" | "agent";

export type DocUserRecord = {
  userId: string;
  sessionKey: string;
  createdAt: number;
  displayLabel?: string;
};

export type DocCitation = {
  path: string;
  heading?: string;
  startLine: number;
  endLine: number;
  snippet: string;
};

export type DocSearchHit = DocCitation & {
  score: number;
  text: string;
  retrievalBucket?: "concept" | "procedural";
  retrievalPurpose?:
    | "primary_concept"
    | "primary_procedural"
    | "prerequisite"
    | "overview"
    | "adjacent"
    | "api";
  docShape?: "quickstart_step" | "specialized_task" | "overview" | "generic_reference";
};

export type DocAnswerSource = "memory_standard" | "memory_draft" | "generated" | "greeting";

export type DocAnswerReviewStatus =
  | "not_applicable"
  | "pending_review"
  | "approved_standard"
  | "rejected";

export type DocAnswerSurface = {
  kind: "extractive" | "learning_agent" | "learning_mock" | "openai_compatible";
  trust: "not_applicable" | "authoritative" | "non_authoritative";
  outputContract: "grounded_extractive" | "sentinel_prompt" | "plain_text";
  note?: string;
};

export type DocAnswerValidationIssue = {
  code:
    | "missing_citation"
    | "citation_topic_mismatch"
    | "cross_platform"
    | "cross_api_layer"
    | "missing_clarification"
    | "section_mismatch"
    | "overclaim_after_trim"
    | "off_intent_answer";
  severity: "warn" | "error";
  message: string;
};

export type DocAnswerValidationResult = {
  ok: boolean;
  issues: DocAnswerValidationIssue[];
  downgradeTo?: "clarification" | "insufficient";
};

export type DocAnswerDebugAnswers = {
  finalAnswerSource:
    | "provider"
    | "grounded_fallback"
    | "grounded_bypass"
    | "learning"
    | "learning_fallback";
  groundedAnswer?: string;
  providerAnswer?: string;
  providerError?: string;
  providerKind?: "openai_compatible" | "learning";
};

export type DocFollowUpSource = "none" | "clarification_reuse" | "clarification_rewrite";

export type DocMemoryEntryStatus = "pending_review" | "approved_standard" | "rejected";

export type DocsUserCreateParams = {
  displayLabel?: string;
};

export type DocsAskParams = {
  userId: string;
  question: string;
  idempotencyKey: string;
  mode?: DocAssistantMode;
  maxResults?: number;
  backend?: "embedded" | "cli";
  provider?: string;
  model?: string;
};

export type DocsRunStatusParams = {
  runId: string;
};

export type DocsRunWaitParams = {
  runId: string;
  timeoutMs?: number;
};

export type DocsTranscriptParams = {
  userId: string;
};

export type DocsSearchPreviewParams = {
  query: string;
  maxResults?: number;
};

export type DocsHistoryListParams = {
  userId?: string;
  answered?: boolean;
  limit?: number;
};

export type DocQuestionAnswerOutcome =
  | "answered"
  | "non_authoritative"
  | "guided_greeting"
  | "memory_standard"
  | "memory_draft"
  | "clarification_required"
  | "no_relevant_docs"
  | "error"
  | "cancelled";

export type DocQuestionHistoryTaskFrame = {
  intent?: "concept" | "procedural" | "mixed";
  product?: "chat" | "call" | "server";
  platform?: "android" | "ios" | "web" | "flutter";
  apiLayer?: "client" | "server";
  channelKind?: "direct" | "group" | "community" | "open";
  anchors?: {
    focus: string[];
    constraints: string[];
    apiSymbols: string[];
  };
  coverage?: {
    matched: string[];
    missing: string[];
  };
  responseMode?: "definition" | "procedure" | "mixed" | "clarification" | "insufficient";
};

export type DocQuestionHistoryEntry = {
  runId: string;
  userId: string;
  sessionKey: string;
  displayLabel?: string;
  question: string;
  mode: DocAssistantMode;
  askedAt: number;
  completedAt: number;
  terminalStatus: DocsTerminalResult["status"];
  answered: boolean;
  answerOutcome: DocQuestionAnswerOutcome;
  summary: string;
  citationCount: number;
  selectedProvider?: string;
  selectedModel?: string;
  answerPreview: string;
  answerSource?: DocAnswerSource;
  reviewStatus?: DocAnswerReviewStatus;
  memoryEntryId?: string;
  followUpSource?: DocFollowUpSource;
  continuedFromRunId?: string;
  rewrittenQuestion?: string;
  taskFrame?: DocQuestionHistoryTaskFrame;
  debugAnswers?: DocAnswerDebugAnswers;
};

export type AnswerMemoryEntry = {
  entryId: string;
  question: string;
  normalizedQuestion: string;
  questionVariants: string[];
  normalizedQuestionVariants: string[];
  answer: string;
  summary: string;
  citations: DocCitation[];
  mode: DocAssistantMode;
  reviewStatus: DocMemoryEntryStatus;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  hitCount: number;
  provenance: "generated_from_docs" | "admin_approved" | "admin_edited";
  selectedProvider?: string;
  selectedModel?: string;
  sourceRunId?: string;
  reviewNote?: string;
};

export type AnswerMemoryMatch = {
  entry: AnswerMemoryEntry;
  score: number;
  answerSource: "memory_standard" | "memory_draft";
  reviewStatus: "pending_review" | "approved_standard";
  matchedQuestion: string;
};

export type DocsAcceptedResult = {
  runId: string;
  status: "accepted";
  acceptedAt: number;
};

export type DocsTerminalResult = {
  runId: string;
  status: "ok" | "error" | "cancelled";
  mode: DocAssistantMode;
  answer: string;
  summary: string;
  citations: DocCitation[];
  selectedProvider?: string;
  selectedModel?: string;
  attempts?: Array<{
    provider: string;
    model: string;
    ok: boolean;
    reason?: string;
  }>;
  answerSource?: DocAnswerSource;
  memoryEntryId?: string;
  reviewStatus?: DocAnswerReviewStatus;
  followUpSource?: DocFollowUpSource;
  continuedFromRunId?: string;
  rewrittenQuestion?: string;
  answerSurface?: DocAnswerSurface;
  validation?: DocAnswerValidationResult;
  trace?: Record<string, unknown>;
};

export type DocsAdminMemoryListParams = {
  status?: DocMemoryEntryStatus;
  query?: string;
  limit?: number;
};

export type DocsAdminMemoryGetParams = {
  entryId: string;
};

export type DocsAdminMemoryApproveParams = {
  entryId: string;
  editedAnswer?: string;
  summary?: string;
  citations?: DocCitation[];
  questionVariants?: string[];
};

export type DocsAdminMemoryRejectParams = {
  entryId: string;
  reason?: string;
};

export type DocsAdminMemoryUpdateParams = {
  entryId: string;
  editedAnswer: string;
  summary?: string;
  citations?: DocCitation[];
  questionVariants?: string[];
};

export type OpenAICompatibleConfig = {
  baseURL: string;
  apiKey: string;
  model?: string;
};

export function makeError(code: DocAssistantErrorCode, message: string): DocAssistantError {
  return { code, message };
}

export function serializeMessage(frame: DocAssistantResponse | DocAssistantEvent): string {
  return JSON.stringify(frame);
}

export function parseClientMessage(raw: string): DocAssistantRequest | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.id === "string" && typeof parsed.method === "string") {
      return parsed as DocAssistantRequest;
    }
    return null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateDocsUserCreateParams(params: unknown): params is DocsUserCreateParams {
  if (params === undefined) {
    return true;
  }
  if (!isRecord(params)) {
    return false;
  }
  return params.displayLabel === undefined || typeof params.displayLabel === "string";
}

export function validateDocsAskParams(params: unknown): params is DocsAskParams {
  if (!isRecord(params)) {
    return false;
  }
  return (
    typeof params.userId === "string" &&
    params.userId.trim().length > 0 &&
    typeof params.question === "string" &&
    params.question.trim().length > 0 &&
    typeof params.idempotencyKey === "string" &&
    params.idempotencyKey.trim().length > 0 &&
    (params.mode === undefined || params.mode === "extractive" || params.mode === "agent") &&
    (params.maxResults === undefined ||
      (typeof params.maxResults === "number" &&
        Number.isFinite(params.maxResults) &&
        params.maxResults > 0)) &&
    (params.backend === undefined || params.backend === "embedded" || params.backend === "cli") &&
    (params.provider === undefined || typeof params.provider === "string") &&
    (params.model === undefined || typeof params.model === "string")
  );
}

export function validateDocsRunWaitParams(params: unknown): params is DocsRunWaitParams {
  if (!isRecord(params)) {
    return false;
  }
  return (
    typeof params.runId === "string" &&
    params.runId.trim().length > 0 &&
    (params.timeoutMs === undefined ||
      (typeof params.timeoutMs === "number" &&
        Number.isFinite(params.timeoutMs) &&
        params.timeoutMs > 0))
  );
}

export function validateDocsRunStatusParams(params: unknown): params is DocsRunStatusParams {
  if (!isRecord(params)) {
    return false;
  }
  return typeof params.runId === "string" && params.runId.trim().length > 0;
}

export function validateDocsTranscriptParams(params: unknown): params is DocsTranscriptParams {
  if (!isRecord(params)) {
    return false;
  }
  return typeof params.userId === "string" && params.userId.trim().length > 0;
}

export function validateDocsSearchPreviewParams(
  params: unknown,
): params is DocsSearchPreviewParams {
  if (!isRecord(params)) {
    return false;
  }
  return (
    typeof params.query === "string" &&
    params.query.trim().length > 0 &&
    (params.maxResults === undefined ||
      (typeof params.maxResults === "number" &&
        Number.isFinite(params.maxResults) &&
        params.maxResults > 0))
  );
}

export function validateDocsHistoryListParams(params: unknown): params is DocsHistoryListParams {
  if (params === undefined) {
    return true;
  }
  if (!isRecord(params)) {
    return false;
  }
  return (
    (params.userId === undefined || typeof params.userId === "string") &&
    (params.answered === undefined || typeof params.answered === "boolean") &&
    (params.limit === undefined ||
      (typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0))
  );
}

export function validateDocsAdminMemoryListParams(
  params: unknown,
): params is DocsAdminMemoryListParams {
  if (params === undefined) {
    return true;
  }
  if (!isRecord(params)) {
    return false;
  }
  return (
    (params.status === undefined ||
      params.status === "pending_review" ||
      params.status === "approved_standard" ||
      params.status === "rejected") &&
    (params.query === undefined || typeof params.query === "string") &&
    (params.limit === undefined ||
      (typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0))
  );
}

export function validateDocsAdminMemoryGetParams(
  params: unknown,
): params is DocsAdminMemoryGetParams {
  if (!isRecord(params)) {
    return false;
  }
  return typeof params.entryId === "string" && params.entryId.trim().length > 0;
}

function validateDocCitationArray(value: unknown): value is DocCitation[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.path === "string" &&
        (item.heading === undefined || typeof item.heading === "string") &&
        typeof item.startLine === "number" &&
        Number.isFinite(item.startLine) &&
        typeof item.endLine === "number" &&
        Number.isFinite(item.endLine) &&
        typeof item.snippet === "string",
    )
  );
}

function validateQuestionVariantArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateDocsAdminMemoryApproveParams(
  params: unknown,
): params is DocsAdminMemoryApproveParams {
  if (!isRecord(params)) {
    return false;
  }
  return (
    typeof params.entryId === "string" &&
    params.entryId.trim().length > 0 &&
    (params.editedAnswer === undefined || typeof params.editedAnswer === "string") &&
    (params.summary === undefined || typeof params.summary === "string") &&
    (params.citations === undefined || validateDocCitationArray(params.citations)) &&
    (params.questionVariants === undefined || validateQuestionVariantArray(params.questionVariants))
  );
}

export function validateDocsAdminMemoryRejectParams(
  params: unknown,
): params is DocsAdminMemoryRejectParams {
  if (!isRecord(params)) {
    return false;
  }
  return (
    typeof params.entryId === "string" &&
    params.entryId.trim().length > 0 &&
    (params.reason === undefined || typeof params.reason === "string")
  );
}

export function validateDocsAdminMemoryUpdateParams(
  params: unknown,
): params is DocsAdminMemoryUpdateParams {
  if (!isRecord(params)) {
    return false;
  }
  return (
    typeof params.entryId === "string" &&
    params.entryId.trim().length > 0 &&
    typeof params.editedAnswer === "string" &&
    params.editedAnswer.trim().length > 0 &&
    (params.summary === undefined || typeof params.summary === "string") &&
    (params.citations === undefined || validateDocCitationArray(params.citations)) &&
    (params.questionVariants === undefined || validateQuestionVariantArray(params.questionVariants))
  );
}
