import { normalizeLearningInboundContext, type LearningInboundContext } from "./inbound-context.js";

export type LearningMockChannel = {
  id: string;
  normalize: (input: Record<string, unknown>) => LearningInboundContext;
};

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function createMockTelegramChannel(): LearningMockChannel {
  return {
    id: "telegram",
    normalize(input) {
      return normalizeLearningInboundContext({
        channel: "telegram",
        accountId: stringValue(input.accountId, "default"),
        peerId:
          typeof input.chatId === "string" ? input.chatId : stringValue(input.peerId, "unknown"),
        chatType: (input.chatType as LearningInboundContext["chatType"] | undefined) ?? "direct",
        text: stringValue(input.text, ""),
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
        accountId: stringValue(input.accountId, "default"),
        peerId:
          typeof input.channelId === "string"
            ? input.channelId
            : stringValue(input.peerId, "unknown"),
        parentPeerId: typeof input.threadParentId === "string" ? input.threadParentId : undefined,
        chatType: (input.chatType as LearningInboundContext["chatType"] | undefined) ?? "channel",
        text: typeof input.content === "string" ? input.content : stringValue(input.text, ""),
        senderId: typeof input.senderId === "string" ? input.senderId : undefined,
        mentioned: Boolean(input.mentioned),
        guildId: typeof input.guildId === "string" ? input.guildId : undefined,
      });
    },
  };
}
