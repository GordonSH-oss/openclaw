import type { LearningInboundContext } from "./inbound-context.js";

export type LearningSessionScope =
  | "main"
  | "per-peer"
  | "per-channel-peer"
  | "per-account-channel-peer";

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

export function buildLearningSessionKey(params: {
  agentId: string;
  context: Pick<LearningInboundContext, "channel" | "accountId" | "peer" | "chatType">;
  scope?: LearningSessionScope;
}): string {
  const agentId = normalizeToken(params.agentId);
  if (params.context.chatType !== "direct") {
    return `agent:${agentId}:${normalizeToken(params.context.channel)}:${params.context.peer.kind}:${params.context.peer.id}`;
  }
  const scope = params.scope ?? "main";
  if (scope === "main") {
    return `agent:${agentId}:main`;
  }
  if (scope === "per-peer") {
    return `agent:${agentId}:direct:${params.context.peer.id}`;
  }
  if (scope === "per-channel-peer") {
    return `agent:${agentId}:${normalizeToken(params.context.channel)}:direct:${params.context.peer.id}`;
  }
  return `agent:${agentId}:${normalizeToken(params.context.channel)}:${normalizeToken(params.context.accountId)}:direct:${params.context.peer.id}`;
}
