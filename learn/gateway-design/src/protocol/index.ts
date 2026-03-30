export type GatewayRequest = {
  id: string;
  method: string;
  params?: unknown;
};

export type GatewayErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "TIMEOUT";

export type GatewayError = {
  code: GatewayErrorCode;
  message: string;
};

export type GatewayResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: GatewayError;
  meta?: Record<string, unknown>;
};

export type GatewayEvent = {
  event: string;
  data: unknown;
};

export type ConnectParams = {
  token?: string;
  clientId?: string;
  caps?: string[];
};

export type ConnectedClient = {
  connId: string;
  authenticated: boolean;
  scopes: string[];
  connect: ConnectParams;
};

export type AgentParams = {
  message: string;
  sessionKey?: string;
  idempotencyKey: string;
  agentId?: string;
  provider?: string;
  model?: string;
  backend?: "embedded" | "cli";
  timeout?: number;
};

export type AgentWaitParams = {
  runId: string;
  timeoutMs?: number;
};

export type AgentAcceptedResult = {
  runId: string;
  status: "accepted";
  acceptedAt: number;
};

export type AgentCompletedResult = {
  runId: string;
  status: "ok" | "error" | "cancelled";
  summary: string;
  reply?: string;
};

export type SessionsChangedEvent = {
  sessionKey: string;
  reason: "create" | "send" | "complete" | "reset" | "error" | "delete" | "cancel";
  ts: number;
  sessionId?: string;
  status?: "idle" | "running" | "error";
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  updatedAt?: number;
};

export function makeError(code: GatewayErrorCode, message: string): GatewayError {
  return { code, message };
}

export function serializeMessage(frame: GatewayResponse | GatewayEvent): string {
  return JSON.stringify(frame);
}

export function parseClientMessage(raw: string): GatewayRequest | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.id === "string" && typeof parsed.method === "string") {
      return parsed as GatewayRequest;
    }
    return null;
  } catch {
    return null;
  }
}

export function validateAgentParams(params: unknown): params is AgentParams {
  if (typeof params !== "object" || params === null) {
    return false;
  }
  const payload = params as Record<string, unknown>;
  return (
    typeof payload.message === "string" &&
    payload.message.trim().length > 0 &&
    typeof payload.idempotencyKey === "string" &&
    payload.idempotencyKey.trim().length > 0
  );
}

export function validateAgentWaitParams(params: unknown): params is AgentWaitParams {
  if (typeof params !== "object" || params === null) {
    return false;
  }
  return typeof (params as Record<string, unknown>).runId === "string";
}
