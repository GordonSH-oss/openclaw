import { detectDocShape } from "./doc-shape.js";
import type { DocSearchHit } from "./protocol/index.js";
import { isBroadIntegrationRequest } from "./question-anchors.js";
import {
  detectQuestionChannelKind,
  detectQuestionPlatform,
  detectQuestionProduct,
  type QuestionChannelKind,
  type QuestionPlatform,
  type QuestionProduct,
  type QuestionState,
} from "./question-state.js";

export type ClarificationKind =
  | "platform"
  | "channel_kind"
  | "api_layer"
  | "product"
  | "task_focus";

export type ClarificationDecision = {
  shouldClarify: boolean;
  kind?: ClarificationKind;
  question?: string;
  reason?: string;
  pendingState?: Partial<QuestionState>;
  candidateOptions?: string[];
};

function collectHitPlatforms(hits: DocSearchHit[]): QuestionPlatform[] {
  const authoritativeHits = hits.filter((hit) => !hit.path.includes("/partials/"));
  const sourceHits = authoritativeHits.length > 0 ? authoritativeHits : hits;
  return Array.from(
    new Set(
      sourceHits
        .map((hit) => detectQuestionPlatform([hit.path, hit.heading ?? "", hit.text].join("\n")))
        .filter((value): value is QuestionPlatform => value !== undefined),
    ),
  );
}

function collectHitChannelKinds(hits: DocSearchHit[]): QuestionChannelKind[] {
  const authoritativeHits = hits.filter((hit) => !hit.path.includes("/partials/"));
  const sourceHits = authoritativeHits.length > 0 ? authoritativeHits : hits;
  return Array.from(
    new Set(
      sourceHits
        .map((hit) => detectQuestionChannelKind([hit.path, hit.heading ?? "", hit.text].join("\n")))
        .filter((value): value is QuestionChannelKind => value !== undefined),
    ),
  );
}

function collectHitProducts(hits: DocSearchHit[]): QuestionProduct[] {
  const authoritativeHits = hits.filter((hit) => !hit.path.includes("/partials/"));
  const sourceHits = authoritativeHits.length > 0 ? authoritativeHits : hits;
  return Array.from(
    new Set(
      sourceHits
        .map((hit) => detectQuestionProduct([hit.path, hit.heading ?? "", hit.text].join("\n")))
        .filter((value): value is QuestionProduct => value !== undefined),
    ),
  );
}

function buildClarificationPrompt(kind: ClarificationKind, state: QuestionState): string {
  if (kind === "task_focus") {
    if (state.product === "server" || state.apiLayer === "server") {
      return state.language === "zh"
        ? "Server API 的接入范围还太宽。请告诉我你具体要做什么，例如 token / 鉴权、webhook 或签名校验、消息/频道操作、权限控制，或者某个具体 endpoint。"
        : "Server API integration is still too broad. Tell me what you need, such as token/auth, webhook or signature verification, messaging or channel operations, permission control, or a specific endpoint.";
    }
    return state.language === "zh"
      ? "这个接入问题还需要再收窄一点。请告诉我你具体要做什么，例如初始化、连接、发送消息、权限、webhook，或者某个具体 API。"
      : "This integration question is still too broad. Tell me the exact task, such as initialization, connection, messaging, permissions, webhook setup, or a specific API.";
  }
  if (kind === "channel_kind") {
    return state.language === "zh"
      ? "你要创建哪一种 channel？例如 direct channel、group channel，还是 community channel？"
      : "Which kind of channel do you want to create: direct channel, group channel, or community channel?";
  }
  if (kind === "api_layer") {
    return state.language === "zh"
      ? "你要看客户端 SDK 的连接流程，还是 Server API 侧的接入方式？"
      : "Do you want the client SDK connection flow or the Server API integration path?";
  }
  if (kind === "product") {
    return state.language === "zh"
      ? "你要看 Chat、Call，还是 Server 相关文档？"
      : "Do you want Chat, Call, or Server documentation?";
  }
  return state.language === "zh"
    ? "这是一个和平台相关的问题。请告诉我要看 Android、iOS、Web，还是 Flutter。"
    : "This question depends on the target platform. Tell me whether you need Android, iOS, Web, or Flutter.";
}

function needsTaskFocusClarification(state: QuestionState, hits: DocSearchHit[]): boolean {
  if (!(state.product === "server" || state.apiLayer === "server")) {
    return false;
  }
  if (!isBroadIntegrationRequest(state)) {
    return false;
  }
  if (hits.length === 0) {
    return true;
  }
  const shapes = hits.map((hit) => hit.docShape ?? detectDocShape(hit));
  const hasQuickstart = shapes.some((shape) => shape === "quickstart_step");
  const hasSpecializedTask = shapes.some((shape) => shape === "specialized_task");
  return !hasQuickstart && !hasSpecializedTask;
}

export function decideClarification(params: {
  state: QuestionState;
  hits?: DocSearchHit[];
}): ClarificationDecision {
  const { state } = params;
  if (state.intent === "concept" || state.intent === "mixed") {
    return { shouldClarify: false };
  }

  const hits = params.hits ?? [];
  const hitPlatforms = collectHitPlatforms(hits);
  const hitChannelKinds = collectHitChannelKinds(hits);
  const hitProducts = collectHitProducts(hits);

  if (state.ambiguity.missingApiLayer) {
    return {
      shouldClarify: true,
      kind: "api_layer",
      question: buildClarificationPrompt("api_layer", state),
      reason: "retrieval spans both client SDK and server API material",
      pendingState: { apiLayer: undefined },
      candidateOptions: ["client", "server"],
    };
  }

  if (state.ambiguity.missingProduct && hits.length > 0) {
    return {
      shouldClarify: true,
      kind: "product",
      question: buildClarificationPrompt("product", state),
      reason:
        hitProducts.length > 1
          ? "retrieval spans multiple product surfaces"
          : "question does not specify whether the user needs chat, call, or server docs",
      pendingState: { product: undefined },
      candidateOptions: hitProducts.length > 0 ? hitProducts : ["chat", "call", "server"],
    };
  }

  if (needsTaskFocusClarification(state, hits)) {
    return {
      shouldClarify: true,
      kind: "task_focus",
      question: buildClarificationPrompt("task_focus", state),
      reason: "server api integration request is still too broad after stable-slot clarification",
      candidateOptions:
        state.language === "zh"
          ? ["token / 鉴权", "webhook / 签名校验", "消息 / 频道操作", "权限控制", "具体 endpoint"]
          : [
              "token/auth",
              "webhook/signature verification",
              "messaging/channel operations",
              "permissions",
              "specific endpoint",
            ],
    };
  }

  if (state.ambiguity.missingChannelKind && hitChannelKinds.length > 1) {
    return {
      shouldClarify: true,
      kind: "channel_kind",
      question: buildClarificationPrompt("channel_kind", state),
      reason: "retrieval spans multiple channel kinds",
      pendingState: { channelKind: undefined },
      candidateOptions: hitChannelKinds,
    };
  }

  if (state.ambiguity.missingPlatform && hitPlatforms.length > 1) {
    return {
      shouldClarify: true,
      kind: "platform",
      question: buildClarificationPrompt("platform", state),
      reason: "retrieval spans multiple SDK platforms",
      pendingState: { platform: undefined },
      candidateOptions: hitPlatforms,
    };
  }

  return { shouldClarify: false };
}
