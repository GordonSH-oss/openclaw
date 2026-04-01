import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLearningSessionKey,
  createMockDiscordChannel,
  createMockTelegramChannel,
  evaluateLearningChannelPolicy,
  normalizeLearningInboundContext,
  resolveLearningRoute,
  resolveLearningDefaultAccount,
} from "./index.js";

void test("route priority is peer > parent peer > account > channel > default", () => {
  const route = resolveLearningRoute({
    context: normalizeLearningInboundContext({
      channel: "discord",
      accountId: "acct-1",
      peerId: "thread-1",
      parentPeerId: "channel-1",
      chatType: "channel",
      text: "hello",
    }),
    bindings: [
      { match: { channel: "discord" }, agentId: "fallback" },
      { match: { channel: "discord", accountId: "acct-1" }, agentId: "account" },
      {
        match: { channel: "discord", parentPeer: { kind: "channel", id: "channel-1" } },
        agentId: "parent",
      },
      { match: { channel: "discord", peer: { kind: "channel", id: "thread-1" } }, agentId: "peer" },
    ],
    defaultAgentId: "default",
  });
  assert.equal(route.agentId, "peer");
});

void test("DM session scope variants build stable session keys", () => {
  const context = normalizeLearningInboundContext({
    channel: "telegram",
    accountId: "owner",
    peerId: "user-1",
    chatType: "direct",
    text: "hi",
  });
  assert.equal(
    buildLearningSessionKey({ agentId: "main", context, scope: "main" }),
    "agent:main:main",
  );
  assert.equal(
    buildLearningSessionKey({ agentId: "main", context, scope: "per-peer" }),
    "agent:main:direct:user-1",
  );
  assert.equal(
    buildLearningSessionKey({ agentId: "main", context, scope: "per-channel-peer" }),
    "agent:main:telegram:direct:user-1",
  );
  assert.equal(
    buildLearningSessionKey({ agentId: "main", context, scope: "per-account-channel-peer" }),
    "agent:main:telegram:owner:direct:user-1",
  );
});

void test("account lookup and policy evaluation stay deterministic", () => {
  assert.equal(
    resolveLearningDefaultAccount({
      configuredAccounts: ["primary", "backup"],
      defaultAccountId: "backup",
    }),
    "backup",
  );
  const policy = evaluateLearningChannelPolicy({
    context: normalizeLearningInboundContext({
      channel: "discord",
      accountId: "acct",
      peerId: "room",
      chatType: "group",
      text: "hello",
      senderId: "u-1",
      mentioned: false,
    }),
    allowFrom: ["u-1"],
    requireMentionInGroups: true,
  });
  assert.deepEqual(policy, {
    allowed: true,
    needsMention: true,
    shouldReply: false,
  });
});

void test("mock channels normalize different inbound shapes into a shared context", () => {
  const telegram = createMockTelegramChannel().normalize({
    accountId: "bot",
    chatId: "42",
    text: "hello",
    chatType: "direct",
  });
  const discord = createMockDiscordChannel().normalize({
    accountId: "bot",
    channelId: "room-1",
    content: "hello",
    chatType: "channel",
    guildId: "guild-1",
  });
  assert.equal(telegram.channel, "telegram");
  assert.equal(discord.channel, "discord");
  assert.equal(discord.guildId, "guild-1");
});
