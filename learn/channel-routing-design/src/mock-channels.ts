import { normalizeLearningInboundContext, type LearningInboundContext } from "./inbound-context.js";

export type LearningMockChannel = {
  id: string;
  normalize: (input: Record<string, unknown>) => LearningInboundContext;
};

export function createMockTelegramChannel(): LearningMockChannel {
  return {
    id: "telegram",
    normalize(input) {
      return normalizeLearningInboundContext({
        channel: "telegram",
        accountId: String(input.accountId ?? "default"),
        peerId: String(input.chatId ?? input.peerId ?? "unknown"),
        chatType: (input.chatType as LearningInboundContext["chatType"] | undefined) ?? "direct",
        text: String(input.text ?? ""),
        senderId: typeof input.senderId === "string" ? input.senderId : undefined,
        mentioned: Boolean(input.mentioned),
      });
    },
  };
}

export function createMockDiscordChannel(): LearningMockChannel {
  return {
    id: "discord",
    normalize(input) {
      return normalizeLearningInboundContext({
        channel: "discord",
        accountId: String(input.accountId ?? "default"),
        peerId: String(input.channelId ?? input.peerId ?? "unknown"),
        parentPeerId: typeof input.threadParentId === "string" ? input.threadParentId : undefined,
        chatType: (input.chatType as LearningInboundContext["chatType"] | undefined) ?? "channel",
        text: String(input.content ?? input.text ?? ""),
        senderId: typeof input.senderId === "string" ? input.senderId : undefined,
        mentioned: Boolean(input.mentioned),
        guildId: typeof input.guildId === "string" ? input.guildId : undefined,
      });
    },
  };
}
