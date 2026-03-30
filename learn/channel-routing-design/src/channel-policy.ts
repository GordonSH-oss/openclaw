import type { LearningInboundContext } from "./inbound-context.js";

export type LearningChannelPolicyResult = {
  allowed: boolean;
  needsMention: boolean;
  shouldReply: boolean;
};

export function evaluateLearningChannelPolicy(params: {
  context: LearningInboundContext;
  allowFrom?: string[];
  requireMentionInGroups?: boolean;
}): LearningChannelPolicyResult {
  const allowlist = new Set((params.allowFrom ?? []).map((value) => value.trim()).filter(Boolean));
  const senderAllowed =
    allowlist.size === 0 ||
    allowlist.has("*") ||
    (params.context.senderId ? allowlist.has(params.context.senderId) : false);
  const needsMention = params.context.chatType !== "direct" && params.requireMentionInGroups !== false;
  const shouldReply = senderAllowed && (!needsMention || params.context.mentioned === true);
  return {
    allowed: senderAllowed,
    needsMention,
    shouldReply,
  };
}
