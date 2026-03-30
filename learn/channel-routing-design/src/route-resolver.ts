import type { LearningBinding } from "./bindings.js";
import type { LearningInboundContext } from "./inbound-context.js";
import { buildLearningSessionKey, type LearningSessionScope } from "./session-key.js";

export type LearningResolvedRoute = {
  agentId: string;
  sessionKey: string;
  matchedBy:
    | "binding.peer"
    | "binding.parentPeer"
    | "binding.account"
    | "binding.channel"
    | "default";
};

export function resolveLearningRoute(params: {
  context: LearningInboundContext;
  bindings: LearningBinding[];
  defaultAgentId: string;
  sessionScope?: LearningSessionScope;
}): LearningResolvedRoute {
  const channelBindings = params.bindings.filter(
    (binding) => binding.match.channel.trim().toLowerCase() === params.context.channel,
  );
  const peerMatch = channelBindings.find(
    (binding) =>
      binding.match.peer?.kind === params.context.peer.kind &&
      binding.match.peer?.id === params.context.peer.id,
  );
  if (peerMatch) {
    return {
      agentId: peerMatch.agentId,
      sessionKey: buildLearningSessionKey({
        agentId: peerMatch.agentId,
        context: params.context,
        scope: params.sessionScope,
      }),
      matchedBy: "binding.peer",
    };
  }
  const parentPeerMatch =
    params.context.parentPeer &&
    channelBindings.find(
      (binding) =>
        binding.match.parentPeer?.kind === params.context.parentPeer?.kind &&
        binding.match.parentPeer?.id === params.context.parentPeer?.id,
    );
  if (parentPeerMatch) {
    return {
      agentId: parentPeerMatch.agentId,
      sessionKey: buildLearningSessionKey({
        agentId: parentPeerMatch.agentId,
        context: params.context,
        scope: params.sessionScope,
      }),
      matchedBy: "binding.parentPeer",
    };
  }
  const accountMatch = channelBindings.find(
    (binding) => binding.match.accountId?.trim().toLowerCase() === params.context.accountId,
  );
  if (accountMatch) {
    return {
      agentId: accountMatch.agentId,
      sessionKey: buildLearningSessionKey({
        agentId: accountMatch.agentId,
        context: params.context,
        scope: params.sessionScope,
      }),
      matchedBy: "binding.account",
    };
  }
  const channelMatch = channelBindings.find(
    (binding) => !binding.match.accountId && !binding.match.peer && !binding.match.parentPeer,
  );
  if (channelMatch) {
    return {
      agentId: channelMatch.agentId,
      sessionKey: buildLearningSessionKey({
        agentId: channelMatch.agentId,
        context: params.context,
        scope: params.sessionScope,
      }),
      matchedBy: "binding.channel",
    };
  }
  return {
    agentId: params.defaultAgentId,
    sessionKey: buildLearningSessionKey({
      agentId: params.defaultAgentId,
      context: params.context,
      scope: params.sessionScope,
    }),
    matchedBy: "default",
  };
}
