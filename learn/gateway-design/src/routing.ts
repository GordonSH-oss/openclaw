/**
 * routing.ts — 消息路由逻辑
 *
 * 【核心问题】一条来自 Telegram 用户 "alice" 的消息，应该交给哪个 agent 处理？
 *
 * 答案通过 "binding 规则" 来决定：
 *   - 配置里写了 "Telegram 的 alice 用户 → 交给 agent-A"
 *   - 没有匹配的规则 → 交给默认 agent
 *
 * 路由结果包含：
 *   - agentId：哪个 agent 来处理
 *   - sessionKey：用哪个 session（也是 transcript 文件的唯一标识）
 */

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/**
 * 消息来源信息（由 channel 层提供）
 */
export type InboundMessageSource = {
  /** channel 名称：如 "telegram"、"discord"、"web" */
  channel: string;
  /** 发送方账户 ID（如 Telegram userId、Discord userId） */
  accountId?: string;
  /** 对话对象：DM（direct）或 群组（group/channel） */
  peer?: {
    kind: "direct" | "group" | "channel";
    id: string;
  };
  /** 服务器/工作区 ID（如 Discord guildId、Slack workspaceId） */
  guildId?: string;
};

/**
 * Binding 规则：配置在 config 文件里，决定消息路由
 *
 * 例：
 * {
 *   match: { channel: "telegram", accountId: "123456" },
 *   agentId: "alice-agent"
 * }
 */
export type BindingRule = {
  /** 匹配条件 */
  match: {
    channel: string;
    accountId?: string;  // 精确匹配 accountId，不填则匹配所有
    peer?: { kind: string; id: string };
    guildId?: string;
  };
  /** 匹配时选择的 agent */
  agentId: string;
};

/**
 * 路由解析结果
 */
export type ResolvedRoute = {
  agentId: string;
  /** session key，如 "default/main" 或 "alice-agent/telegram/direct:123456" */
  sessionKey: string;
  /** 是哪个规则匹配上的（用于调试日志） */
  matchedBy: "binding.peer" | "binding.account" | "binding.channel" | "default";
};

// ─── Session Key 构建 ─────────────────────────────────────────────────────────

/**
 * 构建 session key
 *
 * session key 的格式表示了"哪个 agent 在哪个 channel 上和哪个用户/群组的对话"：
 *
 * 直聊（DM）：  "<agentId>/<channel>/direct:<accountId>"
 * 群组：        "<agentId>/<channel>/group:<groupId>"
 * 全局主 session："<agentId>/main"
 *
 * 例：
 *   "default/main"                          ← 默认全局 session
 *   "alice-agent/telegram/direct:123456"    ← alice-agent 和 Telegram 用户 123456 的 DM
 *   "alice-agent/discord/group:789456"      ← alice-agent 在 Discord 群组 789456
 */
export function buildSessionKey(params: {
  agentId: string;
  channel?: string;
  accountId?: string;
  peer?: { kind: string; id: string };
}): string {
  const { agentId, channel, accountId, peer } = params;

  // 无 channel 信息 → 全局主 session
  if (!channel) {
    return `${agentId}/main`;
  }

  const peerPart = peer
    ? `${peer.kind}:${peer.id}`
    : accountId
      ? `direct:${accountId}`
      : "main";

  return `${agentId}/${channel}/${peerPart}`.toLowerCase();
}

/**
 * 从 session key 中提取 agentId
 * 例："alice-agent/telegram/direct:123456" → "alice-agent"
 */
export function agentIdFromSessionKey(sessionKey: string): string {
  return sessionKey.split("/")[0] ?? "default";
}

// ─── 路由解析 ─────────────────────────────────────────────────────────────────

/**
 * 路由匹配优先级（从高到低）：
 *
 * 1. peer 精确匹配（最具体：特定群组/频道）
 * 2. accountId 精确匹配（次具体：特定用户）
 * 3. channel 通配匹配（该 channel 上的所有消息）
 * 4. 默认 agent（兜底）
 *
 * 这个优先级设计保证了"越具体的规则优先级越高"。
 */
export function resolveAgentRoute(params: {
  source: InboundMessageSource;
  bindings: BindingRule[];
  defaultAgentId: string;
}): ResolvedRoute {
  const { source, bindings, defaultAgentId } = params;
  const channel = source.channel.toLowerCase().trim();
  const accountId = source.accountId?.trim() ?? "";

  // 过滤出匹配当前 channel 的 bindings
  const channelBindings = bindings.filter(
    (b) => b.match.channel.toLowerCase().trim() === channel,
  );

  // ── 优先级 1：peer 精确匹配 ──────────────────────────────────────
  if (source.peer) {
    const peerBinding = channelBindings.find(
      (b) =>
        b.match.peer &&
        b.match.peer.kind === source.peer!.kind &&
        b.match.peer.id === source.peer!.id,
    );
    if (peerBinding) {
      return {
        agentId: peerBinding.agentId,
        sessionKey: buildSessionKey({
          agentId: peerBinding.agentId,
          channel,
          peer: source.peer,
        }),
        matchedBy: "binding.peer",
      };
    }
  }

  // ── 优先级 2：accountId 精确匹配 ─────────────────────────────────
  if (accountId) {
    const accountBinding = channelBindings.find(
      (b) => b.match.accountId === accountId && !b.match.peer,
    );
    if (accountBinding) {
      return {
        agentId: accountBinding.agentId,
        sessionKey: buildSessionKey({
          agentId: accountBinding.agentId,
          channel,
          accountId,
        }),
        matchedBy: "binding.account",
      };
    }
  }

  // ── 优先级 3：channel 通配（无 accountId 限制）──────────────────
  const channelWildcard = channelBindings.find(
    (b) => !b.match.accountId && !b.match.peer,
  );
  if (channelWildcard) {
    return {
      agentId: channelWildcard.agentId,
      sessionKey: buildSessionKey({
        agentId: channelWildcard.agentId,
        channel,
        accountId: accountId || undefined,
      }),
      matchedBy: "binding.channel",
    };
  }

  // ── 优先级 4：默认 agent ─────────────────────────────────────────
  return {
    agentId: defaultAgentId,
    sessionKey: buildSessionKey({
      agentId: defaultAgentId,
      channel: channel || undefined,
      accountId: accountId || undefined,
      peer: source.peer,
    }),
    matchedBy: "default",
  };
}

// ─── 示例 ─────────────────────────────────────────────────────────────────────
/*
 * 使用示例：
 *
 * const bindings: BindingRule[] = [
 *   { match: { channel: "telegram", accountId: "111222" }, agentId: "vip-agent" },
 *   { match: { channel: "telegram" }, agentId: "default" },
 *   { match: { channel: "discord", peer: { kind: "group", id: "server123:channel456" } }, agentId: "server-agent" },
 * ];
 *
 * resolveAgentRoute({
 *   source: { channel: "telegram", accountId: "111222" },
 *   bindings,
 *   defaultAgentId: "default",
 * });
 * // → { agentId: "vip-agent", sessionKey: "vip-agent/telegram/direct:111222", matchedBy: "binding.account" }
 *
 * resolveAgentRoute({
 *   source: { channel: "telegram", accountId: "999888" },
 *   bindings,
 *   defaultAgentId: "default",
 * });
 * // → { agentId: "default", sessionKey: "default/telegram/direct:999888", matchedBy: "binding.channel" }
 */
