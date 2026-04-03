import type { DocSearchHit } from "./protocol/index.js";
import {
  detectQuestionChannelKind,
  detectQuestionPlatform,
  type QuestionChannelKind,
  type QuestionPlatform,
  type QuestionState,
} from "./question-state.js";

export type ClarificationKind = "platform" | "channel_kind" | "api_layer" | "product";

export type ClarificationDecision = {
  shouldClarify: boolean;
  kind?: ClarificationKind;
  question?: string;
  reason?: string;
  pendingState?: Partial<QuestionState>;
  candidateOptions?: string[];
};

function collectHitPlatforms(hits: DocSearchHit[]): QuestionPlatform[] {
  return Array.from(
    new Set(
      hits
        .map((hit) => detectQuestionPlatform([hit.path, hit.heading ?? "", hit.text].join("\n")))
        .filter((value): value is QuestionPlatform => value !== undefined),
    ),
  );
}

function collectHitChannelKinds(hits: DocSearchHit[]): QuestionChannelKind[] {
  return Array.from(
    new Set(
      hits
        .map((hit) => detectQuestionChannelKind([hit.path, hit.heading ?? "", hit.text].join("\n")))
        .filter((value): value is QuestionChannelKind => value !== undefined),
    ),
  );
}

function buildClarificationPrompt(kind: ClarificationKind, state: QuestionState): string {
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
