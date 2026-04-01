export type LearningPeerKind = "direct" | "group" | "channel";

export type LearningInboundContext = {
  channel: string;
  accountId: string;
  chatType: LearningPeerKind;
  peer: { kind: LearningPeerKind; id: string };
  parentPeer?: { kind: LearningPeerKind; id: string };
  guildId?: string;
  teamId?: string;
  text: string;
  mentioned?: boolean;
  senderId?: string;
};

/**
 * channel 层的职责是把各自 transport 的奇形怪状入站 payload，
 * 折叠成 routing 层真正关心的统一上下文。
 */
export function normalizeLearningInboundContext(input: {
  channel: string;
  accountId?: string;
  chatType?: LearningPeerKind;
  peerId: string;
  parentPeerId?: string;
  guildId?: string;
  teamId?: string;
  text?: string;
  mentioned?: boolean;
  senderId?: string;
}): LearningInboundContext {
  const chatType = input.chatType ?? "direct";
  return {
    channel: input.channel.trim().toLowerCase(),
    accountId: (input.accountId ?? "default").trim().toLowerCase(),
    chatType,
    peer: { kind: chatType, id: input.peerId.trim() },
    parentPeer: input.parentPeerId ? { kind: chatType, id: input.parentPeerId.trim() } : undefined,
    guildId: input.guildId?.trim(),
    teamId: input.teamId?.trim(),
    text: (input.text ?? "").trim(),
    mentioned: input.mentioned,
    senderId: input.senderId?.trim(),
  };
}
