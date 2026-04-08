import { detectDocShape } from "./doc-shape.js";
import type { DocSearchHit } from "./protocol/index.js";
import { extractQuestionAnchors, isBroadIntegrationRequest } from "./question-anchors.js";
import { detectPreferredDocShape } from "./question-planning.js";
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
  | "task_focus"
  | "referent";

export type ClarificationDecision = {
  shouldClarify: boolean;
  kind?: ClarificationKind;
  question?: string;
  reason?: string;
  pendingState?: Partial<QuestionState>;
  candidateOptions?: string[];
};

function getAuthoritativeHits(hits: DocSearchHit[]): DocSearchHit[] {
  const authoritativeHits = hits.filter((hit) => !hit.path.includes("/partials/"));
  return authoritativeHits.length > 0 ? authoritativeHits : hits;
}

function addTaskFocusCandidate(
  candidates: Map<string, number>,
  value: string | undefined,
  score: number,
): void {
  if (!value) {
    return;
  }
  candidates.set(value, Math.max(candidates.get(value) ?? 0, score));
}

function collectTaskFocusCandidates(
  hits: DocSearchHit[],
  language: QuestionState["language"],
): string[] {
  const candidates = new Map<string, number>();
  const endpointPattern = /\/v\d+\/[a-z0-9/_-]+/gi;

  for (const hit of getAuthoritativeHits(hits).slice(0, 8)) {
    const combinedText = [hit.path, hit.heading ?? "", hit.text].join("\n");
    const normalized = combinedText.toLowerCase();
    const anchors = extractQuestionAnchors(combinedText);
    const nounSet = new Set(anchors.nounPhrases);
    const constraintSet = new Set(anchors.constraints);

    if (
      nounSet.has("access token") ||
      normalized.includes("access token") ||
      normalized.includes("/access-token/") ||
      normalized.includes("authentication")
    ) {
      addTaskFocusCandidate(
        candidates,
        language === "zh" ? "access token / 鉴权" : "access token",
        10,
      );
    }

    if (
      nounSet.has("webhook signature") ||
      (nounSet.has("webhook") &&
        (nounSet.has("signature") || constraintSet.has("signature verification")))
    ) {
      addTaskFocusCandidate(
        candidates,
        language === "zh" ? "webhook / 签名校验" : "webhook signature verification",
        9,
      );
    }

    if (nounSet.has("permission") || constraintSet.has("permission")) {
      const permissionCandidate = nounSet.has("mention")
        ? language === "zh"
          ? "提及权限"
          : "mention permission"
        : nounSet.has("message thread")
          ? language === "zh"
            ? "话题权限"
            : "thread permission"
          : language === "zh"
            ? "permission"
            : "permission";
      addTaskFocusCandidate(candidates, permissionCandidate, 8);
    }

    if (normalized.includes("blocklist")) {
      addTaskFocusCandidate(candidates, language === "zh" ? "黑名单" : "blocklist", 7);
    }

    for (const match of combinedText.matchAll(endpointPattern)) {
      addTaskFocusCandidate(candidates, match[0], 6);
    }
  }

  return Array.from(candidates.entries())
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value]) => value)
    .slice(0, 5);
}

function collectHitPlatforms(hits: DocSearchHit[]): QuestionPlatform[] {
  const sourceHits = getAuthoritativeHits(hits);
  return Array.from(
    new Set(
      sourceHits
        .map((hit) => detectQuestionPlatform([hit.path, hit.heading ?? "", hit.text].join("\n")))
        .filter((value): value is QuestionPlatform => value !== undefined),
    ),
  );
}

function collectHitChannelKinds(hits: DocSearchHit[]): QuestionChannelKind[] {
  const sourceHits = getAuthoritativeHits(hits);
  return Array.from(
    new Set(
      sourceHits
        .map((hit) => detectQuestionChannelKind([hit.path, hit.heading ?? "", hit.text].join("\n")))
        .filter((value): value is QuestionChannelKind => value !== undefined),
    ),
  );
}

function collectHitProducts(hits: DocSearchHit[]): QuestionProduct[] {
  const sourceHits = getAuthoritativeHits(hits);
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
        ? "Server API 的接入范围还太宽。请告诉我你具体要完成的服务端任务，或者直接给我一个更具体的 endpoint、对象或约束。"
        : "Server API integration is still too broad. Tell me the exact server-side task you need, or name a more specific endpoint, object, or constraint.";
    }
    return state.language === "zh"
      ? "这个接入问题还需要再收窄一点。请告诉我你具体要完成的任务，或者直接给我一个更具体的 API、对象或约束。"
      : "This integration question is still too broad. Tell me the exact task, or name a more specific API, object, or constraint.";
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
  if (kind === "referent") {
    return state.language === "zh"
      ? "这里的术语还不够确定。你说的 system notification，是指 system message，还是 push notification？"
      : 'The terminology is still ambiguous. When you say "system notification", do you mean a system message or a push notification?';
  }
  return state.language === "zh"
    ? "这是一个和平台相关的问题。请告诉我要看 Android、iOS、Web，还是 Flutter。"
    : "This question depends on the target platform. Tell me whether you need Android, iOS, Web, or Flutter.";
}

function collectReferentCandidates(state: QuestionState, hits: DocSearchHit[]): string[] {
  const normalizedQuestion = state.rawQuestion.toLowerCase();
  const mentionsSystemNotification =
    normalizedQuestion.includes("system notification") ||
    normalizedQuestion.includes("system notifications");
  const alreadyExplicit =
    normalizedQuestion.includes("system message") ||
    normalizedQuestion.includes("push notification");
  if (!mentionsSystemNotification || alreadyExplicit) {
    return [];
  }

  const candidates = new Map<string, number>();
  for (const hit of getAuthoritativeHits(hits).slice(0, 8)) {
    const combinedText = [hit.path, hit.heading ?? "", hit.text].join("\n").toLowerCase();
    if (
      combinedText.includes("system message") ||
      combinedText.includes("system messages") ||
      combinedText.includes("/system-channel/message/")
    ) {
      candidates.set("system message", Math.max(candidates.get("system message") ?? 0, 10));
    }
    if (
      combinedText.includes("push notification") ||
      combinedText.includes("push notifications") ||
      combinedText.includes("/system-channel/push") ||
      combinedText.includes("push to tagged users")
    ) {
      candidates.set("push notification", Math.max(candidates.get("push notification") ?? 0, 9));
    }
  }

  return Array.from(candidates.entries())
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value]) => value)
    .slice(0, 3);
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

function needsProductClarification(state: QuestionState, hits: DocSearchHit[]): boolean {
  if (state.product) {
    return false;
  }

  const hitProducts = collectHitProducts(hits);
  if (hitProducts.length > 1) {
    return true;
  }

  if (state.ambiguity.missingProduct) {
    return true;
  }

  return detectPreferredDocShape(state.rawQuestion) === "quickstart_step";
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

  if (
    needsProductClarification(state, hits) &&
    (hits.length > 0 ||
      isBroadIntegrationRequest(state) ||
      detectPreferredDocShape(state.rawQuestion) === "quickstart_step")
  ) {
    return {
      shouldClarify: true,
      kind: "product",
      question: buildClarificationPrompt("product", state),
      reason:
        hitProducts.length > 1
          ? "retrieval spans multiple product surfaces"
          : "question does not specify whether the user needs chat, call, or server docs",
      pendingState: { product: undefined },
      candidateOptions: hitProducts.length > 1 ? hitProducts : ["chat", "call", "server"],
    };
  }

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

  const referentCandidates = collectReferentCandidates(state, hits);
  if (referentCandidates.length > 0) {
    return {
      shouldClarify: true,
      kind: "referent",
      question: buildClarificationPrompt("referent", state),
      reason:
        "retrieval suggests nearby server-side referents for ambiguous system-notification wording",
      candidateOptions: referentCandidates,
    };
  }

  if (needsTaskFocusClarification(state, hits)) {
    const candidateOptions = collectTaskFocusCandidates(hits, state.language);
    return {
      shouldClarify: true,
      kind: "task_focus",
      question: buildClarificationPrompt("task_focus", state),
      reason: "server api integration request is still too broad after stable-slot clarification",
      candidateOptions,
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
