import {
  normalizeLearningInboundContext,
  resolveLearningRoute,
  type LearningBinding,
  type LearningResolvedRoute,
} from "../../channel-routing-design/src/index.js";

/**
 * gateway learning 包仍然保留一个本地 `routing.ts`，但它现在只是 control-plane 适配层。
 *
 * 真正的路由规则、session scope 语义和入站标准化都下沉到
 * `learn/channel-routing-design`，这样 Gateway 本身只负责“消费路由结果”。
 */
export type InboundMessageSource = {
  channel: string;
  accountId?: string;
  peer?: {
    kind: "direct" | "group" | "channel";
    id: string;
  };
  parentPeer?: {
    kind: "direct" | "group" | "channel";
    id: string;
  };
  guildId?: string;
  teamId?: string;
};

export type BindingRule = LearningBinding;
export type ResolvedRoute = LearningResolvedRoute;

export function resolveAgentRoute(params: {
  source: InboundMessageSource;
  bindings: BindingRule[];
  defaultAgentId: string;
}): ResolvedRoute {
  return resolveLearningRoute({
    context: normalizeLearningInboundContext({
      channel: params.source.channel,
      accountId: params.source.accountId,
      peerId: params.source.peer?.id ?? params.source.accountId ?? "unknown",
      parentPeerId: params.source.parentPeer?.id,
      chatType: params.source.peer?.kind ?? "direct",
      guildId: params.source.guildId,
      teamId: params.source.teamId,
      text: "",
    }),
    bindings: params.bindings,
    defaultAgentId: params.defaultAgentId,
  });
}
