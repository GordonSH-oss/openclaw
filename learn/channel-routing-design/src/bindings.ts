import type { LearningPeerKind } from "./inbound-context.js";

export type LearningBinding = {
  match: {
    channel: string;
    accountId?: string;
    peer?: { kind: LearningPeerKind; id: string };
    parentPeer?: { kind: LearningPeerKind; id: string };
  };
  agentId: string;
};

export function sortLearningBindings(bindings: LearningBinding[]): LearningBinding[] {
  return [...bindings];
}
