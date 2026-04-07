import { extractQuestionAnchors, type QuestionAnchors } from "./question-anchors.js";
import { detectProceduralTaskKind, planDocQuestion } from "./question-planning.js";
import { normalizeSearchText } from "./search-text.js";

// `QuestionState` is the normalized snapshot that follow-up rewriting, answerability checks,
// retrieval planning, and answer generation all share. `question-execution.ts` is the primary
// caller for `buildQuestionState()`, while follow-up helpers merge patches into the same shape.
export type QuestionLanguage = "zh" | "en";
export type QuestionIntent = "concept" | "procedural" | "mixed";
export type QuestionPlatform = "android" | "ios" | "web" | "flutter";
export type QuestionChannelKind = "direct" | "group" | "community" | "open";
export type QuestionApiLayer = "client" | "server";
export type QuestionProduct = "chat" | "call" | "server";
export type QuestionAction =
  | "connect"
  | "start"
  | "create"
  | "send"
  | "recall"
  | "delete"
  | "update"
  | "query";
export type QuestionObject =
  | "message"
  | "channel"
  | "conversation"
  | "notification"
  | "user"
  | "webhook";
export type QuestionTaskKind =
  | "first_message"
  | "send_message"
  | "start_chat"
  | "channel_creation"
  | "generic";

export type QuestionState = {
  rawQuestion: string;
  normalizedQuestion: string;
  language: QuestionLanguage;
  intent: QuestionIntent;
  platform?: QuestionPlatform;
  product?: QuestionProduct;
  apiLayer?: QuestionApiLayer;
  channelKind?: QuestionChannelKind;
  referent?: string;
  anchors: QuestionAnchors;
  heuristicHints?: {
    taskKind?: QuestionTaskKind;
    action?: QuestionAction;
    object?: QuestionObject;
    messageSubtype?: "text" | "image" | "file" | "voice" | "targeted" | "generic";
  };
  ambiguity: {
    missingPlatform: boolean;
    missingChannelKind: boolean;
    missingApiLayer: boolean;
    missingProduct: boolean;
  };
};

const STRICT_SERVER_PRODUCT_SIGNALS = ["platform chat api"];
const LOOSE_SERVER_PRODUCT_SIGNALS = ["server api", "rest api", "http api", "服务端"];
const CHAT_PRODUCT_SIGNALS = ["chat sdk", "chatsdk"];
const CALL_PRODUCT_SIGNALS = ["call sdk", "callsdk"];

export function normalizeQuestionText(text: string): string {
  return normalizeSearchText(text).replace(/\s+/g, " ").trim();
}

export function detectQuestionLanguage(question: string): QuestionLanguage {
  const cjkCount = (question.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (cjkCount > 0) {
    return "zh";
  }
  return "en";
}

export function detectQuestionPlatform(value: string): QuestionPlatform | undefined {
  const normalized = normalizeQuestionText(value);
  if (normalized.includes("android")) {
    return "android";
  }
  if (normalized.includes("ios") || normalized.includes("iphone") || normalized.includes("ipad")) {
    return "ios";
  }
  if (normalized.includes("flutter") || normalized.includes("dart")) {
    return "flutter";
  }
  if (normalized.includes("web") || normalized.includes("h5") || normalized.includes("browser")) {
    return "web";
  }
  return undefined;
}

export function detectQuestionChannelKind(value: string): QuestionChannelKind | undefined {
  const normalized = normalizeQuestionText(value);
  if (normalized.includes("open channel")) {
    return "open";
  }
  if (
    normalized.includes("community channel") ||
    normalized.includes("subchannel") ||
    normalized.includes("private subchannel")
  ) {
    return "community";
  }
  if (
    normalized.includes("direct system channels") ||
    normalized.includes("direct channel") ||
    normalized.includes("one to one") ||
    normalized.includes("single chat") ||
    normalized.includes("单聊")
  ) {
    return "direct";
  }
  if (
    normalized.includes("group channel") ||
    normalized.includes("group chat") ||
    normalized.includes("create a group") ||
    normalized.includes("群聊")
  ) {
    return "group";
  }
  return undefined;
}

export function detectQuestionApiLayer(value: string): QuestionApiLayer | undefined {
  const normalized = normalizeQuestionText(value);
  if (
    normalized.includes("server api") ||
    normalized.includes("platform chat api") ||
    normalized.includes("rest api") ||
    normalized.includes("http api") ||
    normalized.includes("api endpoint") ||
    normalized.includes("服务端")
  ) {
    return "server";
  }
  const mentionsSdk =
    normalized.includes("sdk") ||
    normalized.includes("chat sdk") ||
    normalized.includes("call sdk") ||
    normalized.includes("callsdk") ||
    normalized.includes("chatsdk");
  const mentionsClientTask =
    normalized.includes("initialize") ||
    normalized.includes("connect") ||
    normalized.includes("send") ||
    normalized.includes("push") ||
    normalized.includes("notification") ||
    normalized.includes("call") ||
    normalized.includes("chat");
  if (
    normalized.includes("client sdk") ||
    normalized.includes("client side") ||
    (mentionsSdk && mentionsClientTask) ||
    normalized.includes("客户端")
  ) {
    return "client";
  }
  return undefined;
}

export function detectQuestionAction(value: string): QuestionAction | undefined {
  const normalized = normalizeQuestionText(value);
  const messageScopedRecall =
    (normalized.includes("recall") ||
      normalized.includes("revoke") ||
      normalized.includes("unsend") ||
      normalized.includes("withdraw")) &&
    normalized.includes("message");
  if (messageScopedRecall) {
    return "recall";
  }
  if (
    (normalized.includes("delete") ||
      normalized.includes("remove") ||
      normalized.includes("destroy")) &&
    normalized.includes("message")
  ) {
    return "recall";
  }
  if (normalized.includes("send")) {
    return "send";
  }
  if (normalized.includes("connect") || normalized.includes("connection")) {
    return "connect";
  }
  if (normalized.includes("create")) {
    return "create";
  }
  if (
    normalized.includes("start") ||
    normalized.includes("begin") ||
    normalized.includes("open chat")
  ) {
    return "start";
  }
  if (
    normalized.includes("delete") ||
    normalized.includes("remove") ||
    normalized.includes("destroy")
  ) {
    return "delete";
  }
  if (
    normalized.includes("configure") ||
    normalized.includes("config") ||
    normalized.includes("change") ||
    normalized.includes("update") ||
    normalized.includes("set ")
  ) {
    return "update";
  }
  if (
    normalized.includes("query") ||
    normalized.includes("retrieve") ||
    normalized.includes("load") ||
    normalized.includes("list") ||
    normalized.includes("check")
  ) {
    return "query";
  }
  return undefined;
}

export function detectQuestionObject(value: string): QuestionObject | undefined {
  const normalized = normalizeQuestionText(value);
  if (
    normalized.includes("message") ||
    normalized.includes("text message") ||
    normalized.includes("image message") ||
    normalized.includes("file message") ||
    normalized.includes("voice message") ||
    normalized.includes("media message") ||
    normalized.includes("targeted message")
  ) {
    return "message";
  }
  if (normalized.includes("webhook")) {
    return "webhook";
  }
  if (normalized.includes("push notification") || normalized.includes("notification")) {
    return "notification";
  }
  if (normalized.includes("user")) {
    return "user";
  }
  if (normalized.includes("conversation") || normalized.includes("chat")) {
    return "conversation";
  }
  if (
    normalized.includes("channel") ||
    normalized.includes("subchannel") ||
    normalized.includes("community") ||
    normalized.includes("group")
  ) {
    return "channel";
  }
  return undefined;
}

export function detectQuestionMessageSubtype(
  value: string,
): "text" | "image" | "file" | "voice" | "targeted" | "generic" | undefined {
  const normalized = normalizeQuestionText(value);
  if (normalized.includes("targeted message") || normalized.includes("specific members")) {
    return "targeted";
  }
  if (normalized.includes("image message") || normalized.includes("photo message")) {
    return "image";
  }
  if (normalized.includes("file message")) {
    return "file";
  }
  if (normalized.includes("voice message") || normalized.includes("audio message")) {
    return "voice";
  }
  if (normalized.includes("text message") || normalized.includes("regular message")) {
    return "text";
  }
  if (normalized.includes("message")) {
    return "generic";
  }
  return undefined;
}

export function detectQuestionReferent(question: string): string | undefined {
  const normalized = normalizeQuestionText(question);
  const prioritized = [
    "community channel",
    "subchannel",
    "group channel",
    "direct channel",
    "open channel",
    "offline messages",
    "webhook",
    "push notification",
  ].find((phrase) => normalized.includes(phrase));
  if (prioritized) {
    return prioritized;
  }

  const looksConceptual =
    normalized.startsWith("what ") ||
    normalized.startsWith("what s ") ||
    normalized.startsWith("whats ") ||
    normalized.startsWith("define ") ||
    normalized.startsWith("definition of ") ||
    normalized.startsWith("explain ") ||
    normalized.startsWith("about ") ||
    normalized.startsWith("什么是") ||
    normalized.startsWith("什么叫") ||
    normalized.startsWith("请解释") ||
    normalized.startsWith("解释一下") ||
    normalized.startsWith("介绍") ||
    normalized.startsWith("关于");
  if (!looksConceptual) {
    return undefined;
  }

  const stripped = question
    .trim()
    .replace(/^(?:what(?:'s| is| are)?|define|definition of|explain|about)\s+/iu, "")
    .replace(/^(?:什么是|什么叫|请解释(?:一下)?|解释一下|介绍(?:一下)?|关于)\s*/u, "")
    .replace(/^(?:a|an|the)\s+/iu, "")
    .replace(/[?？!！.。]+$/u, "")
    .trim();

  return stripped || undefined;
}

function detectQuestionIntent(question: string): QuestionIntent {
  const plan = planDocQuestion(question);
  return plan.kind;
}

export function detectQuestionProduct(value: string): QuestionState["product"] | undefined {
  const normalized = normalizeQuestionText(value);
  if (STRICT_SERVER_PRODUCT_SIGNALS.some((signal) => normalized.includes(signal))) {
    return "server";
  }
  if (CALL_PRODUCT_SIGNALS.some((signal) => normalized.includes(signal))) {
    return "call";
  }
  if (CHAT_PRODUCT_SIGNALS.some((signal) => normalized.includes(signal))) {
    return "chat";
  }
  const mentionsCallTask =
    /\b(?:audio|video|group|incoming|outgoing|one to one|one-to-one|1 to 1|1-to-1)\s+call\b/.test(
      normalized,
    ) ||
    /\b(?:start|make|place|accept|answer|upgrade|receive|join)\b[\w\s-]{0,40}\bcall\b/.test(
      normalized,
    );
  if (mentionsCallTask) {
    return "call";
  }
  if (LOOSE_SERVER_PRODUCT_SIGNALS.some((signal) => normalized.includes(signal))) {
    return "server";
  }
  if (
    normalized.includes("chat") ||
    normalized.includes("message") ||
    normalized.includes("channel") ||
    normalized.includes("conversation")
  ) {
    return "chat";
  }
  return undefined;
}

function computeQuestionAmbiguity(
  draft: Omit<QuestionState, "ambiguity">,
): QuestionState["ambiguity"] {
  const normalized = draft.normalizedQuestion;
  const proceduralish = draft.intent !== "concept";
  const mentionsPlatformDependentTopic =
    normalized.includes("sdk") ||
    normalized.includes("chat") ||
    normalized.includes("call") ||
    normalized.includes("message") ||
    normalized.includes("channel") ||
    normalized.includes("connect") ||
    normalized.includes("initialize") ||
    normalized.includes("send") ||
    normalized.includes("push notification");
  const mentionsChannelCreationTopic =
    normalized.includes("create") &&
    (normalized.includes("channel") ||
      normalized.includes("conversation") ||
      normalized.includes("chat"));
  const mentionsConnectionTopic =
    normalized.includes("connect") || normalized.includes("connection");
  const explicitlyClientServerConnection =
    mentionsConnectionTopic &&
    !normalized.includes("chat server") &&
    !normalized.includes("call server");
  const mentionsProductDependentTopic =
    normalized.includes("sdk") ||
    normalized.includes("api") ||
    normalized.includes("connect") ||
    normalized.includes("integrate") ||
    normalized.includes("integration") ||
    normalized.includes("install") ||
    normalized.includes("set up") ||
    normalized.includes("setup") ||
    normalized.includes("initialize") ||
    normalized.includes("init");

  return {
    missingPlatform:
      proceduralish &&
      !draft.platform &&
      draft.apiLayer !== "server" &&
      mentionsPlatformDependentTopic,
    missingChannelKind: proceduralish && !draft.channelKind && mentionsChannelCreationTopic,
    missingApiLayer: proceduralish && !draft.apiLayer && explicitlyClientServerConnection,
    missingProduct: proceduralish && !draft.product && mentionsProductDependentTopic,
  };
}

export function buildQuestionState(question: string): QuestionState {
  const rawQuestion = question.trim();
  const normalizedQuestion = normalizeQuestionText(rawQuestion);
  const intent = detectQuestionIntent(rawQuestion);
  const draft: Omit<QuestionState, "ambiguity"> = {
    rawQuestion,
    normalizedQuestion,
    language: detectQuestionLanguage(rawQuestion),
    intent,
    platform: detectQuestionPlatform(rawQuestion),
    product: detectQuestionProduct(rawQuestion),
    apiLayer: detectQuestionApiLayer(rawQuestion),
    channelKind: detectQuestionChannelKind(rawQuestion),
    referent: detectQuestionReferent(rawQuestion),
    anchors: extractQuestionAnchors(rawQuestion),
    heuristicHints: {
      taskKind: intent === "concept" ? undefined : detectProceduralTaskKind(rawQuestion),
      action: detectQuestionAction(rawQuestion),
      object: detectQuestionObject(rawQuestion),
      messageSubtype: detectQuestionMessageSubtype(rawQuestion),
    },
  };

  return {
    ...draft,
    ambiguity: computeQuestionAmbiguity(draft),
  };
}

export function mergeQuestionState(
  base: QuestionState,
  patch: Partial<QuestionState>,
): QuestionState {
  const draft: Omit<QuestionState, "ambiguity"> = {
    ...base,
    ...patch,
    rawQuestion: base.rawQuestion,
    normalizedQuestion: normalizeQuestionText(base.rawQuestion),
    anchors: patch.anchors ?? extractQuestionAnchors(base.rawQuestion),
    heuristicHints: patch.heuristicHints ?? {
      taskKind:
        detectQuestionIntent(base.rawQuestion) === "concept"
          ? undefined
          : detectProceduralTaskKind(base.rawQuestion),
      action: detectQuestionAction(base.rawQuestion),
      object: detectQuestionObject(base.rawQuestion),
      messageSubtype: detectQuestionMessageSubtype(base.rawQuestion),
    },
  };
  return {
    ...draft,
    ambiguity: computeQuestionAmbiguity(draft),
  };
}

function formatPlatform(platform: QuestionPlatform): string {
  if (platform === "ios") {
    return "iOS";
  }
  if (platform === "web") {
    return "Web";
  }
  if (platform === "flutter") {
    return "Flutter";
  }
  return "Android";
}

function formatChannelKind(kind: QuestionChannelKind): string {
  if (kind === "direct") {
    return "direct channel";
  }
  if (kind === "group") {
    return "group channel";
  }
  if (kind === "open") {
    return "open channel";
  }
  return "community channel";
}

function formatProduct(product: QuestionProduct, language: QuestionState["language"]): string {
  if (product === "server") {
    return "Server API";
  }
  if (product === "call") {
    return language === "zh" ? "Call SDK" : "Call SDK";
  }
  return language === "zh" ? "Chat SDK" : "Chat SDK";
}

function hasExplicitPlatform(question: string): boolean {
  return detectQuestionPlatform(question) !== undefined;
}

function hasExplicitApiLayer(question: string): boolean {
  return detectQuestionApiLayer(question) !== undefined;
}

function hasExplicitProduct(question: string): boolean {
  return detectQuestionProduct(question) !== undefined;
}

function hasExplicitChannelKind(question: string, kind: QuestionChannelKind): boolean {
  const normalized = normalizeQuestionText(question);
  return normalized.includes(formatChannelKind(kind));
}

export function rewriteQuestionFromState(state: QuestionState): string {
  let rewritten = state.rawQuestion.trim().replace(/[?？!！.。]+$/u, "");
  const normalized = normalizeQuestionText(rewritten);

  if (state.channelKind && !hasExplicitChannelKind(rewritten, state.channelKind)) {
    const label = formatChannelKind(state.channelKind);
    if (/\ba channel\b/i.test(rewritten)) {
      rewritten = rewritten.replace(/\ba channel\b/i, `a ${label}`);
    } else if (/\bchannel\b/i.test(rewritten)) {
      rewritten = rewritten.replace(/\bchannel\b/i, label);
    } else if (!normalized.includes(label)) {
      rewritten = `${rewritten} for ${label}`;
    }
  }

  if (state.apiLayer && !hasExplicitApiLayer(rewritten)) {
    rewritten =
      state.apiLayer === "server"
        ? `${rewritten} using Server API`
        : `${rewritten} using Client SDK`;
  }

  if (state.product && !hasExplicitProduct(rewritten)) {
    const productLabel = formatProduct(state.product, state.language);
    if (state.language === "en") {
      rewritten = `${rewritten} for ${productLabel}`;
    } else {
      rewritten = `${rewritten}（${productLabel}）`;
    }
  }

  if (state.platform && !hasExplicitPlatform(rewritten)) {
    if (state.language === "en") {
      rewritten = `${rewritten} on ${formatPlatform(state.platform)}`;
    } else {
      rewritten = `${formatPlatform(state.platform)} ${rewritten}`;
    }
  }

  return `${rewritten}?`;
}
