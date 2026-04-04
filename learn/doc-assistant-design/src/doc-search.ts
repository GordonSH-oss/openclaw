import { rebuildDocIndexIfNeeded, tokenize, type DocIndexChunk } from "./doc-index.js";
import {
  countMatchingPlatforms,
  detectDocShape,
  detectDocTier,
  getBasenameStem,
  getPathPlatforms,
  getTierWeight,
  type DocSearchDocShape,
  type DocTier,
} from "./doc-shape.js";
import type { DocCitation, DocSearchHit } from "./protocol/index.js";
import {
  detectPreferredDocShape,
  detectProceduralTaskKind,
  planDocQuestion,
  type DocPreferredDocShape,
  type DocProceduralTaskKind,
  type DocQuestionIntent,
  type DocQuestionPlan,
  type DocQuestionPlanKind,
  type DocQuestionPlanStep,
} from "./question-planning.js";
import type { QuestionState } from "./question-state.js";
import type { RetrievalPurpose } from "./retrieval-plan.js";
import {
  GENERIC_QUERY_TOKENS,
  PLATFORM_TOKENS,
  PRODUCT_TOKENS,
  countTokenMatches,
  countTokenOverlap,
  countUniqueTokenOverlap,
  getCoverageCriticalQueryTokens,
  getStrongQueryTokens,
  normalizeSearchText,
  normalizeSnippet,
} from "./search-text.js";

// Retrieval lives here. `question-execution.ts` calls `searchDocs()` / `searchDocsForPurpose()`
// after it decides the current turn should hit the local doc index, and tests in
// `doc-search.test.ts` pin the ranking behavior when heuristics change.
type MustCoverAnchorRule = {
  required: string[];
  anyOf: string[];
  positiveBoost: number;
  missingPenalty: number;
  partialBoost: number;
};
type QueryIntent =
  | "start"
  | "send"
  | "connect"
  | "accept"
  | "configure"
  | "require"
  | "install"
  | "initialize"
  | "receive"
  | "end"
  | "upgrade"
  | "release";

type QueryChannelKind = "direct" | "group" | "community" | "open";
export type DocRetrievalBucket = "concept" | "procedural";
export type RetrievalOverrides = {
  preferredPaths?: string[];
  discouragedPaths?: string[];
};
export { detectDocShape, detectPreferredDocShape, detectProceduralTaskKind, planDocQuestion };
export type {
  DocPreferredDocShape,
  DocProceduralTaskKind,
  DocQuestionIntent,
  DocQuestionPlan,
  DocQuestionPlanKind,
  DocQuestionPlanStep,
  DocSearchDocShape,
};

const CONCEPT_QUERY_MARKERS = [
  "what",
  "what s",
  "whats",
  "what is",
  "what are",
  "meaning",
  "define",
  "definition",
  "explain",
  "about",
  "是什么",
  "什么意思",
  "含义",
  "解释一下",
];

const PROCEDURAL_QUERY_MARKERS = [
  "how to",
  "how do",
  "how can",
  "required",
  "requirements",
  "require",
  "prerequisites",
  "need",
  "start",
  "send",
  "configure",
  "connect",
  "initialize",
  "install",
  "create",
  "set up",
  "setup",
  "发起",
  "配置",
  "连接",
  "初始化",
  "如何",
  "怎么",
  "创建",
];

const PROCEDURAL_NOISE_TERMS = [
  "create",
  "creating",
  "workflow",
  "steps",
  "step",
  "event",
  "events",
  "notification",
  "dnd",
  "manager",
  "delete",
  "modify",
  "history",
];

const MUST_COVER_ANCHOR_RULES: MustCoverAnchorRule[] = [
  {
    required: ["push", "notification"],
    anyOf: ["language", "locale", "localization", "default language"],
    positiveBoost: 88,
    missingPenalty: 72,
    partialBoost: 24,
  },
];

function detectQuerySignals(
  query: string,
  tokens: string[],
): {
  platforms: string[];
  products: string[];
  channelKinds: QueryChannelKind[];
  normalizedQuery: string;
  normalizedTokens: string[];
  intents: QueryIntent[];
} {
  // Keep query analysis centralized so the later rankers can stay mostly pure:
  // they only consume normalized signals instead of re-parsing raw text.
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTokens = tokenize(normalizedQuery);
  return {
    platforms: PLATFORM_TOKENS.filter(
      (token) => tokens.includes(token) || normalizedQuery.includes(token),
    ),
    products: PRODUCT_TOKENS.filter(
      (token) => tokens.includes(token) || normalizedQuery.includes(token),
    ),
    channelKinds: detectQueryChannelKinds(normalizedQuery),
    normalizedQuery,
    normalizedTokens,
    intents: detectQueryIntents(normalizedQuery, normalizedTokens),
  };
}

function detectQueryChannelKinds(normalizedQuery: string): QueryChannelKind[] {
  const kinds = new Set<QueryChannelKind>();
  if (
    normalizedQuery.includes("direct channel") ||
    normalizedQuery.includes("one to one") ||
    normalizedQuery.includes("private chat") ||
    normalizedQuery.includes("dm")
  ) {
    kinds.add("direct");
  }
  if (
    normalizedQuery.includes("group channel") ||
    normalizedQuery.includes("group chat") ||
    normalizedQuery.includes("create a group") ||
    normalizedQuery.includes("create group") ||
    /\bgroup\b/.test(normalizedQuery)
  ) {
    kinds.add("group");
  }
  if (
    normalizedQuery.includes("community channel") ||
    normalizedQuery.includes("subchannel") ||
    normalizedQuery.includes("private subchannel")
  ) {
    kinds.add("community");
  }
  if (normalizedQuery.includes("open channel")) {
    kinds.add("open");
  }
  return Array.from(kinds);
}

function scoreChannelKindAlignment(
  pathText: string,
  headingText: string,
  bodyText: string,
  signals: ReturnType<typeof detectQuerySignals>,
): number {
  if (signals.channelKinds.length === 0) {
    return 0;
  }

  const explicitKinds = new Set(signals.channelKinds);
  const detectedKinds = new Set<QueryChannelKind>([
    ...detectQueryChannelKinds(pathText),
    ...detectQueryChannelKinds(headingText),
    ...detectQueryChannelKinds(bodyText.slice(0, 600)),
  ]);
  let score = 0;

  for (const kind of explicitKinds) {
    if (detectedKinds.has(kind)) {
      score += 18;
    }
    if (kind === "community" && pathText.includes("community channel")) {
      score += 18;
    }
    if (kind === "community" && pathText.includes("community-channels")) {
      score += 14;
    }
    if (kind === "open" && pathText.includes("open-channels")) {
      score += 18;
    }
    if (kind === "direct" && pathText.includes("direct system channels")) {
      score += 18;
    }
    if (kind === "group" && pathText.includes("group channels")) {
      score += 18;
    }
  }

  for (const detected of detectedKinds) {
    if (explicitKinds.has(detected)) {
      continue;
    }
    score -= 24;
  }

  return score;
}

function isChannelCreationQuery(signals: ReturnType<typeof detectQuerySignals>): boolean {
  const normalizedQuery = signals.normalizedQuery;
  const hasCreateIntent =
    normalizedQuery.includes("create") ||
    normalizedQuery.includes("new channel") ||
    normalizedQuery.includes("open channel");
  const mentionsChannel =
    normalizedQuery.includes("channel") ||
    normalizedQuery.includes("conversation") ||
    normalizedQuery.includes("chat");
  const mentionsServerApi =
    normalizedQuery.includes("server api") || normalizedQuery.includes("platform chat api");
  return hasCreateIntent && mentionsChannel && !mentionsServerApi;
}

function isGenericChannelCreationQuery(signals: ReturnType<typeof detectQuerySignals>): boolean {
  return isChannelCreationQuery(signals) && signals.channelKinds.length === 0;
}

function expandQueryTokens(query: string, tokens: string[]): string[] {
  const normalizedQuery = normalizeSearchText(query);
  const expanded = new Set(tokens);
  const signals = detectQuerySignals(query, tokens);

  const add = (...values: string[]) => {
    for (const value of values) {
      if (value.length >= 2) {
        expanded.add(value);
      }
    }
  };

  if (
    normalizedQuery.includes("direct channel") ||
    normalizedQuery.includes("one to one") ||
    normalizedQuery.includes("private chat")
  ) {
    add("direct", "channel", "private", "conversation");
  }

  if (normalizedQuery.includes("conversation")) {
    add("channel");
  }

  if (normalizedQuery.includes("chat")) {
    add("channel");
  }

  if (
    (normalizedQuery.includes("start") ||
      normalizedQuery.includes("begin") ||
      normalizedQuery.includes("first")) &&
    (normalizedQuery.includes("chat") ||
      normalizedQuery.includes("channel") ||
      normalizedQuery.includes("direct"))
  ) {
    add("send", "message", "quickstart", "connect");
  }

  if (isGenericChannelCreationQuery(signals)) {
    add("direct", "conversation", "retrieve", "reload", "list", "group");
  }

  return Array.from(expanded);
}

function detectQueryIntents(normalizedQuery: string, normalizedTokens: string[]): QueryIntent[] {
  const intents = new Set<QueryIntent>();
  const hasToken = (token: string) =>
    normalizedTokens.includes(token) || normalizedQuery.includes(token);

  if (hasToken("start") || hasToken("begin") || hasToken("make first") || hasToken("place")) {
    intents.add("start");
  }
  if (
    hasToken("send") ||
    hasToken("sending") ||
    normalizedQuery.includes("text message") ||
    normalizedQuery.includes("image message") ||
    normalizedQuery.includes("file message") ||
    normalizedQuery.includes("voice message") ||
    normalizedQuery.includes("media message") ||
    normalizedQuery.includes("targeted message")
  ) {
    intents.add("send");
  }
  if (
    hasToken("connect") ||
    hasToken("connection") ||
    hasToken("login") ||
    hasToken("log in") ||
    hasToken("signin") ||
    hasToken("sign in") ||
    hasToken("authenticate")
  ) {
    intents.add("connect");
  }
  if (hasToken("accept") || hasToken("answer") || hasToken("join")) {
    intents.add("accept");
  }
  if (hasToken("configure") || hasToken("config") || hasToken("settings") || hasToken("setup")) {
    intents.add("configure");
  }
  if (hasToken("implement") || hasToken("implementation")) {
    intents.add("configure");
  }
  if (
    hasToken("required") ||
    hasToken("requirements") ||
    hasToken("require") ||
    hasToken("prerequisites") ||
    hasToken("need")
  ) {
    intents.add("require");
  }
  if (hasToken("install")) {
    intents.add("install");
  }
  if (hasToken("initialize") || hasToken("initialization") || hasToken("init")) {
    intents.add("initialize");
  }
  if (hasToken("receive") || hasToken("incoming")) {
    intents.add("receive");
  }
  if (
    hasToken("end") ||
    hasToken("hang up") ||
    hasToken("hangup") ||
    hasToken("reject") ||
    hasToken("delete") ||
    hasToken("remove") ||
    hasToken("destroy") ||
    hasToken("leave") ||
    hasToken("exit")
  ) {
    intents.add("end");
  }
  if (hasToken("upgrade") || hasToken("invite") || hasToken("invitation")) {
    intents.add("upgrade");
  }
  if (
    hasToken("release") ||
    hasToken("releases") ||
    hasToken("version") ||
    hasToken("added") ||
    hasToken("what s new") ||
    /\b\d+\s+\d+\s+\d+\b/.test(normalizedQuery)
  ) {
    intents.add("release");
  }

  return Array.from(intents);
}

function scoreBasenameSemantics(
  basenameStem: string,
  headingText: string,
  signals: ReturnType<typeof detectQuerySignals>,
): number {
  const basenameTokens = tokenize(basenameStem);
  const headingTokens = tokenize(headingText);
  let score = countTokenOverlap(basenameTokens, signals.normalizedTokens) * 6;
  score += countTokenOverlap(headingTokens, signals.normalizedTokens) * 2;

  if (signals.normalizedQuery.includes("one to one")) {
    if (basenameStem.includes("one to one call")) {
      score += 26;
    }
    if (basenameStem.includes("group call")) {
      score -= 14;
    }
  }
  if (
    signals.normalizedQuery.includes("push settings") ||
    signals.normalizedQuery.includes("push config")
  ) {
    if (basenameStem.includes("push config")) {
      score += 22;
    }
  }
  if (signals.normalizedQuery.includes("voip push")) {
    if (basenameStem.includes("callplus voip")) {
      score += 22;
    } else if (basenameStem.includes("voip")) {
      score += 14;
    }
  }
  if (signals.normalizedQuery.includes("group call")) {
    if (basenameStem.includes("group call")) {
      score += 24;
    }
    if (basenameStem.includes("one to one call") && signals.intents.includes("upgrade")) {
      score -= 18;
    }
  }
  if (signals.intents.includes("release") && basenameStem.includes("release notes")) {
    score += 30;
  }
  if (
    (signals.normalizedQuery.includes("chat conversation") ||
      signals.normalizedQuery.includes("chat message") ||
      signals.normalizedQuery.includes("call summary")) &&
    basenameStem.includes("integration to chat")
  ) {
    score += 18;
  }

  return score;
}

function scoreHeadingIntent(
  headingText: string,
  bodyText: string,
  signals: ReturnType<typeof detectQuerySignals>,
): number {
  if (signals.intents.length === 0) {
    return 0;
  }

  const normalizedHeading = normalizeSearchText(headingText);
  const normalizedBody = normalizeSearchText(bodyText.slice(0, 280));
  let score = 0;

  const boost = (intent: QueryIntent, keywords: string[], amount: number, bodyAmount = 0) => {
    if (!signals.intents.includes(intent)) {
      return;
    }
    if (keywords.some((keyword) => normalizedHeading.includes(keyword))) {
      score += amount;
      return;
    }
    if (bodyAmount > 0 && keywords.some((keyword) => normalizedBody.includes(keyword))) {
      score += bodyAmount;
    }
  };

  boost("start", ["start", "make first", "begin"], 18, 6);
  boost(
    "send",
    [
      "send a message",
      "send your first message",
      "send a text message",
      "send a regular message",
      "send an image message",
      "send a file message",
      "send a voice message",
      "send a media message",
      "send a targeted message",
      "message send",
    ],
    28,
    10,
  );
  boost("connect", ["connect", "connection", "login", "log in", "sign in", "authenticate"], 22, 8);
  boost("accept", ["accept", "answer", "receive and accept"], 18, 6);
  boost(
    "configure",
    ["configure", "config", "settings", "properties", "field descriptions"],
    16,
    5,
  );
  boost("require", ["requirements", "required", "prerequisites", "provisioning"], 24, 10);
  boost("require", ["enable"], 12, 5);
  boost("require", ["when to use"], 8, 3);
  boost("install", ["install"], 16, 5);
  boost("initialize", ["initialize", "initialization"], 16, 5);
  boost("receive", ["receive", "incoming"], 12, 4);
  boost("end", ["end", "reject", "hang up", "delete", "remove", "destroy", "leave", "exit"], 12, 4);
  boost("upgrade", ["upgrade", "invite", "group call", "invitation"], 18, 6);
  boost("release", ["release", "added"], 18, 6);

  if (signals.intents.includes("require") && normalizedHeading.includes("receive")) {
    score -= 8;
  }
  if (
    signals.intents.includes("require") &&
    normalizedHeading.includes("when to use") &&
    !normalizedHeading.includes("requirements")
  ) {
    score -= 6;
  }
  if (signals.intents.includes("start") && normalizedHeading.includes("group call")) {
    score -= 10;
  }
  if (signals.intents.includes("upgrade") && normalizedHeading.includes("one to one call")) {
    score -= 10;
  }
  if (signals.intents.includes("end") && normalizedHeading.includes("join")) {
    score -= 14;
  }
  if (signals.intents.includes("release") && normalizedHeading.includes("step")) {
    score -= 8;
  }

  return score;
}

function isExplicitServerApiQuery(signals: ReturnType<typeof detectQuerySignals>): boolean {
  const normalizedQuery = signals.normalizedQuery;
  return (
    normalizedQuery.includes("server api") ||
    normalizedQuery.includes("platform chat api") ||
    normalizedQuery.includes("rest api") ||
    normalizedQuery.includes("http api") ||
    normalizedQuery.includes("api endpoint")
  );
}

function isClientConnectionQuery(signals: ReturnType<typeof detectQuerySignals>): boolean {
  if (isExplicitServerApiQuery(signals)) {
    return false;
  }
  const normalizedQuery = signals.normalizedQuery;
  const hasConnectIntent =
    signals.intents.includes("connect") ||
    normalizedQuery.includes("login") ||
    normalizedQuery.includes("log in") ||
    normalizedQuery.includes("sign in") ||
    normalizedQuery.includes("authenticate");
  const mentionsClientFlow =
    normalizedQuery.includes("chat server") ||
    normalizedQuery.includes("chat sdk") ||
    normalizedQuery.includes("sdk") ||
    normalizedQuery.includes("user") ||
    normalizedQuery.includes("token") ||
    normalizedQuery.includes("connection") ||
    normalizedQuery.includes("chat");

  return hasConnectIntent && mentionsClientFlow;
}

function scorePathSemantics(
  pathText: string,
  headingText: string,
  signals: ReturnType<typeof detectQuerySignals>,
): number {
  let score = 0;
  const normalizedPath = normalizeSearchText(pathText);

  if (signals.normalizedQuery.length >= 6) {
    const normalizedHeading = normalizeSearchText(headingText);
    if (normalizedPath.includes(signals.normalizedQuery)) {
      score += 18;
    }
    if (normalizedHeading.includes(signals.normalizedQuery)) {
      score += 14;
    }
  }

  const tier = detectDocTier(pathText);
  if (tier === "partial") {
    score -= 12;
  }

  if (signals.platforms.length > 0) {
    const pathPlatforms = PLATFORM_TOKENS.filter((token) => pathText.includes(token));
    for (const platform of signals.platforms) {
      if (pathPlatforms.includes(platform)) {
        score += 26;
      }
    }
    for (const platform of pathPlatforms) {
      if (!signals.platforms.includes(platform)) {
        score -= 18;
      }
    }
  }

  if (signals.products.length > 0) {
    const pathProducts = PRODUCT_TOKENS.filter((token) => pathText.includes(token));
    for (const product of signals.products) {
      if (pathProducts.includes(product)) {
        score += 16;
      }
    }
    for (const product of pathProducts) {
      if (!signals.products.includes(product)) {
        score -= 8;
      }
    }
  }

  if (signals.normalizedQuery.includes("webhook")) {
    if (normalizedPath.includes("webhook")) {
      score += 28;
    }
    if (normalizedPath.includes("platform chat api")) {
      score += 12;
    }
    if (normalizedPath.includes("/webhook/overview")) {
      score += 36;
    }
  }

  if (
    signals.normalizedQuery.includes("push notification") &&
    (signals.normalizedQuery.includes("click") || signals.normalizedQuery.includes("conversation"))
  ) {
    if (normalizedPath.includes("handle push notification click")) {
      score += 44;
    }
    if (normalizedPath.includes("config push notification style")) {
      score -= 22;
    }
    if (normalizedPath.includes("disconnect")) {
      score -= 28;
    }
  }

  if (
    (signals.normalizedQuery.includes("call summary") ||
      (signals.normalizedQuery.includes("call") &&
        signals.normalizedQuery.includes("conversation") &&
        signals.normalizedQuery.includes("insert"))) &&
    normalizedPath.includes("integration to chat")
  ) {
    score += 42;
  }

  if (signals.products.includes("callsdk")) {
    if (
      normalizedPath.includes("chatsdk") ||
      normalizedPath.includes("platform chat api") ||
      normalizedPath.includes("group channel")
    ) {
      score -= 36;
    }
    if (normalizedPath.includes("callsdk")) {
      score += 34;
    }
    if (
      normalizedPath.includes("one to one call") ||
      normalizedPath.includes("group call") ||
      normalizedPath.includes("push config")
    ) {
      score += 24;
    }
  }
  if (signals.products.includes("chatsdk") && normalizedPath.includes("callsdk")) {
    score -= 24;
  }
  if (signals.normalizedQuery.includes("chatsdk") && normalizedPath.includes("callsdk")) {
    score -= 32;
  }
  if (signals.normalizedQuery.includes("callsdk") && normalizedPath.includes("chatsdk")) {
    score -= 32;
  }
  if (signals.intents.includes("release") && normalizedPath.includes("release notes")) {
    score += 24;
  }
  if (signals.intents.includes("end")) {
    if (normalizedPath.includes("leaving-channel") || normalizedPath.includes("leave")) {
      score += 34;
    }
    if (normalizedPath.includes("joining-channel") || normalizedPath.includes("join")) {
      score -= 30;
    }
  }
  if (
    (signals.intents.includes("install") || signals.intents.includes("initialize")) &&
    normalizedPath.includes("quickstart")
  ) {
    score += 16;
  }
  if (
    signals.normalizedQuery.includes("open channel") &&
    (normalizedPath.includes("community channel") ||
      normalizedPath.includes("subchannel") ||
      normalizedPath.includes("private subchannel"))
  ) {
    score -= 42;
  }
  if (
    !signals.normalizedQuery.includes("open channel") &&
    normalizedPath.includes("open channel")
  ) {
    score -= 24;
  }
  if (!signals.normalizedQuery.includes("robot") && normalizedPath.includes("robot")) {
    score -= 22;
  }
  if (!signals.normalizedQuery.includes("modify")) {
    if (normalizedPath.includes("modify message")) {
      score -= 18;
    }
    if (normalizedPath.includes("gethistory") || normalizedPath.includes("history")) {
      score -= 10;
    }
  }

  return score;
}

function isGenericWebhookQuery(signals: ReturnType<typeof detectQuerySignals>): boolean {
  const normalizedQuery = signals.normalizedQuery;
  if (!normalizedQuery.includes("webhook")) {
    return false;
  }
  return !(
    normalizedQuery.includes("pre messaging") ||
    normalizedQuery.includes("event") ||
    normalizedQuery.includes("message delete") ||
    normalizedQuery.includes("signature") ||
    normalizedQuery.includes("connection status") ||
    normalizedQuery.includes("open channel") ||
    normalizedQuery.includes("metadata update") ||
    normalizedQuery.includes("operationtype")
  );
}

function scoreWebhookSemantics(
  pathText: string,
  headingText: string,
  bodyText: string,
  signals: ReturnType<typeof detectQuerySignals>,
): number {
  if (!isGenericWebhookQuery(signals)) {
    return 0;
  }

  const normalizedPath = normalizeSearchText(pathText);
  const normalizedHeading = normalizeSearchText(headingText);
  const normalizedBody = normalizeSearchText(bodyText.slice(0, 900));
  let score = 0;

  if (normalizedPath.includes("/webhook/overview")) {
    score += 70;
  }
  if (normalizedPath.includes("platform chat api") && normalizedPath.includes("webhook")) {
    score += 30;
  }
  if (
    normalizedHeading.includes("set up webhook") ||
    normalizedHeading.includes("set up webhooks")
  ) {
    score += 34;
  }
  if (
    normalizedHeading.includes("verify signature") ||
    normalizedHeading.includes("verify signatures")
  ) {
    score += 16;
  }
  if (normalizedBody.includes("register a single endpoint")) {
    score += 18;
  }
  if (normalizedBody.includes("webhook url") || normalizedBody.includes("select the events")) {
    score += 18;
  }

  if (normalizedPath.includes("/webhook/events/")) {
    score -= 40;
  }
  if (normalizedPath.includes("moderation")) {
    score -= 16;
  }

  return score;
}

function isClientSendMessageQuery(signals: ReturnType<typeof detectQuerySignals>): boolean {
  const normalizedQuery = signals.normalizedQuery;
  const mentionsSendMessage =
    signals.intents.includes("send") &&
    (normalizedQuery.includes("message") ||
      normalizedQuery.includes("text") ||
      normalizedQuery.includes("image") ||
      normalizedQuery.includes("file") ||
      normalizedQuery.includes("voice") ||
      normalizedQuery.includes("media") ||
      normalizedQuery.includes("targeted"));
  const mentionsServerApi =
    normalizedQuery.includes("server api") || normalizedQuery.includes("platform chat api");
  return mentionsSendMessage && !mentionsServerApi;
}

function scoreClientSendMessageSemantics(
  pathText: string,
  headingText: string,
  bodyText: string,
  signals: ReturnType<typeof detectQuerySignals>,
): number {
  if (!isClientSendMessageQuery(signals)) {
    return 0;
  }

  const normalizedPath = normalizeSearchText(pathText);
  const normalizedHeading = normalizeSearchText(headingText);
  const normalizedBody = normalizeSearchText(bodyText.slice(0, 800));
  const normalizedQuery = signals.normalizedQuery;
  let score = 0;

  if (normalizedPath.includes("chatsdk")) {
    score += 24;
  }
  if (normalizedPath.includes("/message/")) {
    score += 34;
  }
  if (normalizedPath.endsWith("message send md") || normalizedPath.endsWith("message send mdx")) {
    score += 20;
  }
  if (normalizedPath.includes("platform chat api")) {
    score -= 54;
  }
  if (normalizedPath.includes("sync to sender")) {
    score -= 58;
  }
  if (normalizedPath.includes("query history") || normalizedPath.includes("history")) {
    score -= 32;
  }
  if (normalizedPath.includes("modify message")) {
    score -= 22;
  }

  if (
    normalizedHeading.includes("send a message") ||
    normalizedHeading.includes("send a regular message") ||
    normalizedHeading.includes("send a text message") ||
    normalizedHeading.includes("send an image message") ||
    normalizedHeading.includes("send a file message") ||
    normalizedHeading.includes("send a voice message") ||
    normalizedHeading.includes("send a media message") ||
    normalizedHeading.includes("send a targeted message")
  ) {
    score += 34;
  }
  if (normalizedBody.includes("sendmessage") || normalizedBody.includes("send message")) {
    score += 18;
  }
  if (normalizedBody.includes("messageparams")) {
    score += 18;
  }
  if (normalizedBody.includes("direct channel")) {
    score += 6;
  }
  if (normalizedBody.includes("server api")) {
    score -= 30;
  }
  if (normalizedBody.includes("isechotosender") || normalizedBody.includes("issyncsender")) {
    score -= 36;
  }
  if (
    normalizedBody.includes("sync to the sender") ||
    normalizedBody.includes("sync the message")
  ) {
    score -= 26;
  }

  const subtypeBoosts = [
    { query: "text message", terms: ["text message", "regular message"] },
    { query: "image message", terms: ["image message", "media message"] },
    { query: "file message", terms: ["file message"] },
    { query: "voice message", terms: ["voice message", "audio message"] },
    { query: "targeted message", terms: ["targeted message", "directeduserids"] },
  ];
  for (const subtype of subtypeBoosts) {
    if (!normalizedQuery.includes(subtype.query)) {
      continue;
    }
    if (
      subtype.terms.some(
        (term) => normalizedHeading.includes(term) || normalizedBody.includes(term),
      )
    ) {
      score += 24;
    } else {
      score -= 12;
    }
  }

  return score;
}

function isClientChatStartQuery(signals: ReturnType<typeof detectQuerySignals>): boolean {
  const normalizedQuery = signals.normalizedQuery;
  const hasStartIntent =
    signals.intents.includes("start") ||
    normalizedQuery.includes("first message") ||
    normalizedQuery.includes("quickstart");
  const mentionsChatFlow =
    normalizedQuery.includes("chat") ||
    normalizedQuery.includes("channel") ||
    normalizedQuery.includes("conversation") ||
    normalizedQuery.includes("message");
  const mentionsDirectFlow =
    normalizedQuery.includes("direct channel") ||
    normalizedQuery.includes("one to one") ||
    normalizedQuery.includes("private");
  const mentionsServerApi =
    normalizedQuery.includes("server api") || normalizedQuery.includes("platform chat api");

  return hasStartIntent && (mentionsChatFlow || mentionsDirectFlow) && !mentionsServerApi;
}

function scoreClientChatStartSemantics(
  pathText: string,
  headingText: string,
  bodyText: string,
  signals: ReturnType<typeof detectQuerySignals>,
): number {
  if (!isClientChatStartQuery(signals)) {
    return 0;
  }

  const normalizedPath = normalizeSearchText(pathText);
  const normalizedHeading = normalizeSearchText(headingText);
  const normalizedBody = normalizeSearchText(bodyText.slice(0, 800));
  let score = 0;

  if (normalizedPath.includes("chatsdk")) {
    score += 22;
  }
  if (normalizedPath.includes("chatui")) {
    score += 12;
  }
  if (normalizedPath.includes("platform chat api")) {
    score -= 44;
  }
  if (
    !signals.normalizedQuery.includes("open channel") &&
    normalizedPath.includes("open channel")
  ) {
    score -= 30;
  }
  if (normalizedPath.includes("query history")) {
    score -= 32;
  }
  if (normalizedPath.includes("sync to sender")) {
    score -= 46;
  }
  if (!signals.normalizedQuery.includes("robot") && normalizedPath.includes("robot")) {
    score -= 28;
  }
  if (normalizedPath.includes("modify message")) {
    score -= 22;
  }

  if (normalizedHeading.includes("get started") || normalizedHeading.includes("quickstart")) {
    score += 26;
  }
  if (
    normalizedHeading.includes("send your first message") ||
    normalizedHeading.includes("send a message")
  ) {
    score += 28;
  }
  if (normalizedHeading.includes("initialize") || normalizedHeading.includes("import")) {
    score += 16;
  }
  if (
    signals.normalizedQuery.includes("import") &&
    (normalizedHeading.includes("import") || normalizedPath.includes("/import"))
  ) {
    score += 22;
  }
  if (
    (signals.normalizedQuery.includes("initialize") || signals.normalizedQuery.includes("init")) &&
    (normalizedHeading.includes("initialize") ||
      normalizedPath.includes("quickstart") ||
      normalizedPath.includes("/init"))
  ) {
    score += 24;
  }
  if (
    normalizedHeading.includes("direct channel") ||
    normalizedHeading.includes("channel overview")
  ) {
    score += 18;
  }
  if (
    signals.normalizedQuery.includes("direct channel") &&
    (normalizedPath.includes("direct system channels") ||
      normalizedHeading.includes("direct channel") ||
      normalizedBody.includes("direct channel"))
  ) {
    score += 26;
  }
  if (
    signals.normalizedQuery.includes("push notification") &&
    (signals.normalizedQuery.includes("click") || signals.normalizedQuery.includes("conversation"))
  ) {
    if (normalizedHeading.includes("navigate to the channel page")) {
      score += 82;
    }
    if (normalizedHeading.includes("handle push notification clicks")) {
      score += 36;
    }
    if (normalizedHeading.includes("use pushmessagereceiver")) {
      score += 12;
    }
    if (normalizedBody.includes("intent filter") || normalizedBody.includes("androidmanifest")) {
      score += 30;
    }
    if (normalizedBody.includes("conversation page") || normalizedBody.includes("channel page")) {
      score += 26;
    }
    if (normalizedBody.includes("onnotificationmessagearrived")) {
      score -= 18;
    }
  }

  if (normalizedBody.includes("direct channel")) {
    score += 14;
  }
  if (normalizedBody.includes("one to one private chat")) {
    score += 18;
  }
  if (normalizedBody.includes("sendmessage") || normalizedBody.includes("send message")) {
    score += 16;
  }
  if (normalizedBody.includes("connect")) {
    score += 10;
  }
  if (normalizedHeading.includes("broadcast") || normalizedBody.includes("broadcast")) {
    score -= 18;
  }
  if (normalizedHeading.includes("read receipt") || normalizedBody.includes("read receipt")) {
    score -= 16;
  }
  if (
    signals.normalizedQuery.includes("notification") &&
    (normalizedHeading.includes("channel page") ||
      normalizedHeading.includes("channel list page") ||
      normalizedBody.includes("intent filter") ||
      normalizedBody.includes("androidmanifest"))
  ) {
    score += 32;
  }
  if (
    (signals.intents.includes("install") || signals.intents.includes("initialize")) &&
    (normalizedPath.includes("/import") ||
      normalizedPath.includes("/init") ||
      normalizedHeading.includes("initialize") ||
      normalizedHeading.includes("import"))
  ) {
    score += 24;
  }
  if (
    signals.normalizedQuery.includes("targeted message") &&
    (normalizedHeading.includes("targeted message") || normalizedBody.includes("directeduserids"))
  ) {
    score += 28;
  }
  if (
    signals.normalizedQuery.includes("specific members") &&
    (normalizedHeading.includes("targeted message") || normalizedBody.includes("directeduserids"))
  ) {
    score += 28;
  }
  if (
    signals.normalizedQuery.includes("release notes") &&
    normalizedHeading.includes("new features")
  ) {
    score += 14;
  }
  if (
    (signals.normalizedQuery.includes("call summary") ||
      (signals.normalizedQuery.includes("call") &&
        signals.normalizedQuery.includes("conversation") &&
        signals.normalizedQuery.includes("insert"))) &&
    (normalizedHeading.includes("conversation ui") ||
      normalizedHeading.includes("call log") ||
      normalizedBody.includes("call summary") ||
      normalizedBody.includes("call end information"))
  ) {
    score += 30;
  }
  if (normalizedBody.includes("server api")) {
    score -= 28;
  }
  if (normalizedBody.includes("cloud message history")) {
    score -= 28;
  }
  if (normalizedBody.includes("history message")) {
    score -= 18;
  }
  if (normalizedBody.includes("isechotosender") || normalizedBody.includes("issyncsender")) {
    score -= 28;
  }
  if (
    normalizedBody.includes("sync to the sender") ||
    normalizedBody.includes("sync the message")
  ) {
    score -= 20;
  }

  return score;
}

function scoreClientConnectionSemantics(
  pathText: string,
  headingText: string,
  bodyText: string,
  signals: ReturnType<typeof detectQuerySignals>,
): number {
  if (!isClientConnectionQuery(signals)) {
    return 0;
  }

  const normalizedPath = normalizeSearchText(pathText);
  const normalizedHeading = normalizeSearchText(headingText);
  const normalizedBody = normalizeSearchText(bodyText.slice(0, 800));
  let score = 0;

  if (normalizedPath.includes("chatsdk")) {
    score += 24;
  }
  if (normalizedPath.includes("/connection/")) {
    score += 34;
  }
  if (normalizedPath.endsWith("/connect md") || normalizedPath.includes("/connection/connect")) {
    score += 36;
  }
  if (normalizedHeading.includes("connect") || normalizedHeading.includes("connection")) {
    score += 28;
  }
  if (normalizedBody.includes("token")) {
    score += 12;
  }
  if (normalizedBody.includes("connect")) {
    score += 10;
  }

  if (normalizedPath.includes("platform chat api")) {
    score -= 52;
  }
  if (normalizedPath.includes("chat server api list")) {
    score -= 64;
  }
  if (
    normalizedHeading.includes("default behaviors") ||
    normalizedHeading.includes("channel management")
  ) {
    score -= 28;
  }
  if (normalizedBody.includes("server api")) {
    score -= 30;
  }
  if (
    normalizedPath.includes("community channel") ||
    normalizedPath.includes("group channels") ||
    normalizedPath.includes("direct system channels")
  ) {
    score -= 18;
  }

  return score;
}

function scoreDocShapeSemantics(params: {
  chunk: DocIndexChunk;
  signals: ReturnType<typeof detectQuerySignals>;
  taskKind: DocProceduralTaskKind;
  preferredDocShape: DocPreferredDocShape;
}): number {
  const shape = detectDocShape({
    path: params.chunk.relativePath,
    heading: params.chunk.heading,
    text: params.chunk.text,
  });
  const normalizedQuery = params.signals.normalizedQuery;
  const tutorialFlowRequested =
    normalizedQuery.includes("quickstart") ||
    normalizedQuery.includes("getting started") ||
    normalizedQuery.includes("get started") ||
    normalizedQuery.includes("from scratch") ||
    normalizedQuery.includes("tutorial");
  const platformSpecified = params.signals.platforms.length > 0;
  let score = 0;

  if (params.preferredDocShape === "specialized_task") {
    if (shape === "specialized_task") {
      score += 10;
    }
    if (shape === "quickstart_step") {
      score -= 10;
    }
  } else if (params.preferredDocShape === "quickstart_step") {
    if (shape === "quickstart_step") {
      score += 12;
    }
  }

  if (params.taskKind === "send_message") {
    if (shape === "specialized_task") {
      score += 30;
    }
    if (shape === "quickstart_step") {
      score -= 22;
    }
    return score;
  }

  if (params.taskKind === "first_message") {
    if (tutorialFlowRequested) {
      if (shape === "quickstart_step") {
        score += 24;
      }
      if (shape === "specialized_task") {
        score += 8;
      }
      return score;
    }
    if (platformSpecified) {
      if (shape === "specialized_task") {
        score += 26;
      }
      if (shape === "quickstart_step") {
        score -= 18;
      }
      return score;
    }
    if (shape === "quickstart_step") {
      score += 18;
    }
    if (shape === "specialized_task") {
      score += 10;
    }
    return score;
  }

  if (params.taskKind === "channel_creation") {
    if (shape === "specialized_task") {
      score += 22;
    }
    if (shape === "overview") {
      score -= 6;
    }
    return score;
  }

  if (params.taskKind === "start_chat") {
    if (shape === "quickstart_step") {
      score += 14;
    }
    if (shape === "specialized_task") {
      score += 8;
    }
  }

  return score;
}

function scoreChannelCreationSemantics(
  pathText: string,
  headingText: string,
  bodyText: string,
  signals: ReturnType<typeof detectQuerySignals>,
): number {
  if (!isChannelCreationQuery(signals)) {
    return 0;
  }

  const normalizedPath = normalizeSearchText(pathText);
  const normalizedHeading = normalizeSearchText(headingText);
  const normalizedBody = normalizeSearchText(bodyText.slice(0, 900));
  const explicitKinds = new Set(signals.channelKinds);
  const generic = explicitKinds.size === 0;
  const wantsDirect = generic || explicitKinds.has("direct");
  const wantsGroup = explicitKinds.has("group");
  const wantsCommunity = explicitKinds.has("community");
  const wantsExplicitDirect = explicitKinds.has("direct");

  let score = 0;

  if (wantsDirect) {
    if (normalizedPath.includes("direct system channels")) {
      score += generic ? 34 : 48;
    }
    if (
      normalizedPath.includes("direct-system-channels/overview") ||
      normalizedHeading.includes("create or get a channel instance") ||
      normalizedHeading.includes("create a channel instance") ||
      normalizedBody.includes("create or get a channel instance") ||
      normalizedBody.includes("create a channel instance") ||
      normalizedBody.includes("construct a channel instance") ||
      normalizedBody.includes("sdk creates and maintains the channel relationship")
    ) {
      score += wantsExplicitDirect ? 52 : 30;
    }
    if (
      normalizedHeading.includes("retrieving channels") ||
      normalizedHeading.includes("get a specific channel") ||
      normalizedHeading.includes("get channel list") ||
      normalizedBody.includes("directchannel") ||
      normalizedBody.includes("direct channel")
    ) {
      score += generic ? 18 : 28;
    }
    if (
      normalizedPath.includes("deleting-channel") ||
      normalizedPath.includes("pinning-channel") ||
      normalizedPath.includes("tagging-channels") ||
      normalizedHeading.includes("delete") ||
      normalizedHeading.includes("pin") ||
      normalizedHeading.includes("unpin") ||
      normalizedHeading.includes("tag") ||
      normalizedHeading.includes("retrieving channels") ||
      normalizedHeading.includes("get channel list") ||
      normalizedBody.includes("channel delete") ||
      normalizedBody.includes("deletechannels") ||
      normalizedBody.includes("reload")
    ) {
      score -= wantsExplicitDirect ? 42 : 18;
    }
  }

  if (wantsGroup) {
    if (normalizedPath.includes("group channels")) {
      score += 34;
    }
    if (
      normalizedHeading.includes("create a group") ||
      normalizedBody.includes("creategroupparams") ||
      normalizedBody.includes("groupchannel creategroup")
    ) {
      score += 28;
    }
  } else if (generic) {
    if (normalizedPath.includes("group channels")) {
      score += 8;
    }
    if (normalizedHeading.includes("create a group")) {
      score += 10;
    }
  }

  if (wantsCommunity) {
    if (
      normalizedPath.includes("community channel") ||
      normalizedPath.includes("community channels")
    ) {
      score += 34;
    }
    if (normalizedPath.includes("creating-channel")) {
      score += 36;
    }
    if (
      normalizedHeading.includes("creating community channels") ||
      normalizedHeading.includes("creating community channel") ||
      normalizedHeading.includes("create a community channel") ||
      normalizedHeading.includes("create a subchannel") ||
      normalizedBody.includes("private subchannel")
    ) {
      score += 28;
    }
    if (normalizedBody.includes("server api")) {
      score += 22;
    }
    if (normalizedBody.includes("does not provide client side apis")) {
      score += 18;
    }
    if (normalizedPath.includes("/overview")) {
      score -= 10;
    }
  } else {
    if (
      normalizedPath.includes("community channel") ||
      normalizedPath.includes("community channels") ||
      normalizedHeading.includes("private subchannel") ||
      normalizedBody.includes("private subchannel")
    ) {
      score -= generic ? 28 : 42;
    }
  }

  if (!wantsCommunity && normalizedPath.includes("platform chat api")) {
    score -= 30;
  }
  if (normalizedPath.includes("how to sync to sender")) {
    score -= 56;
  }
  if (normalizedPath.includes("history") || normalizedBody.includes("cloud message history")) {
    score -= 24;
  }

  if (explicitKinds.has("direct")) {
    if (normalizedPath.includes("group channels")) {
      score -= 18;
    }
    if (
      normalizedPath.includes("community channel") ||
      normalizedHeading.includes("private subchannel")
    ) {
      score -= 44;
    }
  }

  if (explicitKinds.has("group") && normalizedPath.includes("direct system channels")) {
    score -= 14;
  }

  if (
    generic &&
    normalizedPath.includes("direct system channels") &&
    normalizedHeading.includes("retrieving channels")
  ) {
    score += 12;
  }

  return score;
}

function scoreEndActionSemantics(
  pathText: string,
  headingText: string,
  bodyText: string,
  signals: ReturnType<typeof detectQuerySignals>,
): number {
  if (!(signals.intents.includes("end") && signals.channelKinds.includes("open"))) {
    return 0;
  }

  const normalizedPath = normalizeSearchText(pathText);
  const normalizedHeading = normalizeSearchText(headingText);
  const normalizedBody = normalizeSearchText(bodyText.slice(0, 900));
  const asksForDestructiveEndAction =
    signals.normalizedQuery.includes("destroy") ||
    signals.normalizedQuery.includes("delete") ||
    signals.normalizedQuery.includes("remove");
  let score = 0;

  // Open-channel end questions should prefer the executable leave flow, not the surrounding
  // event, console, or metadata reference pages that incidentally mention destroy/exit terms.
  if (normalizedPath.includes("open channels")) {
    score += 8;
  }
  if (normalizedPath.includes("leaving channel")) {
    score += 60;
  }
  if (
    normalizedHeading.includes("leave an open channel") ||
    normalizedHeading.includes("active leave")
  ) {
    score += 56;
  }
  if (normalizedBody.includes("exitchannel") || normalizedBody.includes("exit channel")) {
    score += 64;
  }
  if (normalizedBody.includes("left the channel")) {
    score += 18;
  }

  if (normalizedHeading.includes("passive removal") || normalizedBody.includes("auto removal")) {
    score -= 34;
  }
  if (
    normalizedPath.includes("joining channel") ||
    normalizedHeading.includes("join an open channel") ||
    normalizedBody.includes("enterchannel")
  ) {
    score -= 40;
  }
  if (
    normalizedPath.includes("event delegation") ||
    normalizedHeading.includes("event") ||
    normalizedBody.includes("handler") ||
    normalizedBody.includes("callback")
  ) {
    score -= 44;
  }
  if (
    normalizedPath.includes("platform config") ||
    normalizedHeading.includes("feature configuration") ||
    normalizedBody.includes("console")
  ) {
    score -= 38;
  }
  if (
    normalizedPath.includes("managing metadata") ||
    normalizedHeading.includes("metadata") ||
    normalizedBody.includes("delete metadata") ||
    normalizedBody.includes("deletemetadata")
  ) {
    score -= 52;
  }

  if (asksForDestructiveEndAction) {
    if (normalizedHeading.includes("active leave") || normalizedBody.includes("exitchannel")) {
      score += 24;
    }
    if (
      normalizedHeading.includes("open channel events") ||
      normalizedBody.includes("destroyed") ||
      normalizedBody.includes("openchanneldestroyedevent")
    ) {
      score -= 20;
    }
  }

  return score;
}

function extractConceptFocusTokens(signals: ReturnType<typeof detectQuerySignals>): string[] {
  const blacklist = new Set([
    ...CONCEPT_QUERY_MARKERS,
    ...PROCEDURAL_QUERY_MARKERS,
    "channel",
    "channels",
    "sdk",
  ]);
  return signals.normalizedTokens.filter(
    (token) => token.length >= 4 && !GENERIC_QUERY_TOKENS.has(token) && !blacklist.has(token),
  );
}

function looksLikeDefinitionText(text: string): boolean {
  return (
    text.includes(" is a ") ||
    text.includes(" are ") ||
    text.includes(" refers to ") ||
    text.includes(" used for ") ||
    text.includes(" lets ") ||
    text.includes(" enables ")
  );
}

function scoreConceptSemantics(
  pathText: string,
  headingText: string,
  bodyText: string,
  signals: ReturnType<typeof detectQuerySignals>,
): number {
  const normalizedPath = normalizeSearchText(pathText);
  const normalizedHeading = normalizeSearchText(headingText);
  const normalizedBody = normalizeSearchText(bodyText.slice(0, 900));
  const focusTokens = extractConceptFocusTokens(signals);
  let score = 0;

  if (normalizedPath.endsWith("/overview md") || normalizedPath.endsWith("/overview mdx")) {
    score += 32;
  }
  if (normalizedPath.includes("/overview") || normalizedHeading.includes("overview")) {
    score += 22;
  }
  if (normalizedPath.includes("/about") || normalizedHeading.includes("about ")) {
    score += 22;
  }
  if (normalizedPath.includes("glossary") || normalizedHeading.includes("glossary")) {
    score += 20;
  }
  if (looksLikeDefinitionText(` ${normalizedBody} `)) {
    score += 18;
  }
  if (normalizedBody.includes("key features") || normalizedBody.includes("main features")) {
    score += 10;
  }

  if (signals.channelKinds.includes("community")) {
    if (
      normalizedPath.includes("community channel") ||
      normalizedPath.includes("community channels")
    ) {
      score += 18;
    }
    if (normalizedPath.includes("community-channels/overview")) {
      score += 40;
    }
  }

  if (focusTokens.length > 0) {
    const headingMatches = focusTokens.filter(
      (token) => normalizedHeading.includes(token) || normalizedPath.includes(token),
    ).length;
    const bodyMatches = focusTokens.filter((token) => normalizedBody.includes(token)).length;
    score += headingMatches * 10;
    score += bodyMatches * 5;
  }

  for (const term of PROCEDURAL_NOISE_TERMS) {
    if (normalizedPath.includes(term)) {
      score -= 18;
    }
    if (normalizedHeading.includes(term)) {
      score -= 12;
    }
  }

  if (normalizedPath.includes("creating-channel")) {
    score -= 26;
  }
  if (normalizedPath.includes("/events/") || normalizedPath.includes("/event/")) {
    score -= 24;
  }
  if (normalizedPath.includes("do-not-disturb") || normalizedPath.includes("dnd")) {
    score -= 24;
  }

  return score;
}

function scoreSharedChunk(
  chunk: DocIndexChunk,
  query: string,
  tokens: string[],
  signals: ReturnType<typeof detectQuerySignals>,
): number {
  const pathText = chunk.relativePath.toLowerCase();
  const headingText = (chunk.heading ?? "").toLowerCase();
  const bodyText = chunk.text.toLowerCase();
  const basenameStem = getBasenameStem(pathText);

  let score = 0;
  if (
    query &&
    (pathText.includes(query) || headingText.includes(query) || bodyText.includes(query))
  ) {
    score += 8;
  }
  for (const token of tokens) {
    score += countTokenMatches(pathText, token) * 5;
    score += countTokenMatches(headingText, token) * 4;
    score += countTokenMatches(bodyText, token);
  }
  score += scoreChannelKindAlignment(pathText, headingText, bodyText, signals);
  score += scorePathSemantics(pathText, headingText, signals);
  score += scoreBasenameSemantics(basenameStem, headingText, signals);
  score += scoreMustCoverAnchorCoverage(chunk, signals);
  return score;
}

function countMatchedMustCoverAnchors(text: string, anchors: string[]): number {
  return anchors.filter((anchor) => text.includes(normalizeSearchText(anchor))).length;
}

function detectMustCoverAnchorRule(
  signals: ReturnType<typeof detectQuerySignals>,
): MustCoverAnchorRule | undefined {
  return MUST_COVER_ANCHOR_RULES.find((rule) =>
    rule.required.every((anchor) => signals.normalizedQuery.includes(normalizeSearchText(anchor))),
  );
}

function scoreMustCoverAnchorCoverage(
  chunk: DocIndexChunk,
  signals: ReturnType<typeof detectQuerySignals>,
): number {
  const rule = detectMustCoverAnchorRule(signals);
  if (!rule) {
    return 0;
  }

  const normalizedText = normalizeSearchText(
    [chunk.relativePath, chunk.heading ?? "", chunk.text.slice(0, 1200)].join("\n"),
  );
  const matchedRequired = countMatchedMustCoverAnchors(normalizedText, rule.required);
  const matchedAnchors = countMatchedMustCoverAnchors(normalizedText, rule.anyOf);
  const missingRequired = rule.required.length - matchedRequired;

  // This rule family exists for cases where partial semantic overlap is
  // misleading. If the query requires both "push notification" and a locale
  // angle, penalize docs that match only the generic push side.
  if (matchedRequired === rule.required.length && matchedAnchors > 0) {
    return rule.positiveBoost + matchedAnchors * 18;
  }
  if (matchedAnchors > 0) {
    return rule.partialBoost + matchedAnchors * 12 - missingRequired * 8;
  }
  if (matchedRequired === rule.required.length) {
    return -rule.missingPenalty;
  }

  return 0;
}

function scoreProceduralChunk(
  chunk: DocIndexChunk,
  query: string,
  tokens: string[],
  signals: ReturnType<typeof detectQuerySignals>,
  refinement?: {
    taskKind?: DocProceduralTaskKind;
    preferredDocShape?: DocPreferredDocShape;
  },
): number {
  const pathText = chunk.relativePath.toLowerCase();
  const headingText = (chunk.heading ?? "").toLowerCase();
  const bodyText = chunk.text.toLowerCase();

  let score = scoreSharedChunk(chunk, query, tokens, signals);
  score += scoreHeadingIntent(headingText, bodyText, signals);
  score += scoreClientSendMessageSemantics(pathText, headingText, bodyText, signals);
  score += scoreClientChatStartSemantics(pathText, headingText, bodyText, signals);
  score += scoreClientConnectionSemantics(pathText, headingText, bodyText, signals);
  score += scoreWebhookSemantics(pathText, headingText, bodyText, signals);
  score += scoreChannelCreationSemantics(pathText, headingText, bodyText, signals);
  score += scoreEndActionSemantics(pathText, headingText, bodyText, signals);
  score += scoreDocShapeSemantics({
    chunk,
    signals,
    taskKind: refinement?.taskKind ?? detectProceduralTaskKind(query),
    preferredDocShape: refinement?.preferredDocShape ?? detectPreferredDocShape(query),
  });
  if (
    signals.normalizedQuery.includes("push notification") &&
    (signals.normalizedQuery.includes("click") ||
      signals.normalizedQuery.includes("conversation") ||
      signals.normalizedQuery.includes("open"))
  ) {
    if (headingText.includes("navigate to the channel page")) {
      score += 160;
    }
    if (headingText.includes("navigate to the channel matching the message")) {
      score += 160;
    }
    if (headingText.includes("implement the default navigation behavior")) {
      score += 64;
    }
    if (headingText.includes("use pushmessagereceiver") && !bodyText.includes("intent filter")) {
      score -= 24;
    }
  }
  return score;
}

function scoreConceptChunk(
  chunk: DocIndexChunk,
  query: string,
  tokens: string[],
  signals: ReturnType<typeof detectQuerySignals>,
): number {
  const pathText = chunk.relativePath.toLowerCase();
  const headingText = (chunk.heading ?? "").toLowerCase();
  const bodyText = chunk.text.toLowerCase();
  let score = scoreSharedChunk(chunk, query, tokens, signals);
  score += scoreConceptSemantics(pathText, headingText, bodyText, signals);
  return score;
}

function toHit(chunk: DocIndexChunk, score: number): DocSearchHit {
  return {
    path: chunk.relativePath,
    heading: chunk.heading,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    snippet: normalizeSnippet(chunk.text),
    score,
    text: chunk.text,
    docShape: detectDocShape({
      path: chunk.relativePath,
      heading: chunk.heading,
      text: chunk.text,
    }),
  };
}

export function toCitation(hit: DocSearchHit): DocCitation {
  return {
    path: hit.path,
    heading: hit.heading,
    startLine: hit.startLine,
    endLine: hit.endLine,
    snippet: hit.snippet,
  };
}

function scoreBucketedEntries(params: {
  chunks: DocIndexChunk[];
  question: string;
  bucket: DocRetrievalBucket;
  refinement?: {
    taskKind?: DocProceduralTaskKind;
    preferredDocShape?: DocPreferredDocShape;
  };
  overrides?: RetrievalOverrides;
}): Array<{
  chunk: DocIndexChunk;
  score: number;
  strongOverlap: number;
  tier: DocTier;
  basenameStem: string;
  pathPlatforms: string[];
}> {
  const query = params.question.trim().toLowerCase();
  const tokens = expandQueryTokens(query, tokenize(query));
  const scoringTokens = tokens.filter((token) => !GENERIC_QUERY_TOKENS.has(token));
  const strongTokens = getStrongQueryTokens(tokens);
  const coverageTokens = getCoverageCriticalQueryTokens(tokens);
  const signals = detectQuerySignals(query, tokens);
  const scoreChunkForBucket =
    params.bucket === "concept"
      ? (
          chunk: DocIndexChunk,
          query: string,
          tokens: string[],
          signals: ReturnType<typeof detectQuerySignals>,
        ) => scoreConceptChunk(chunk, query, tokens, signals)
      : (
          chunk: DocIndexChunk,
          query: string,
          tokens: string[],
          signals: ReturnType<typeof detectQuerySignals>,
        ) => scoreProceduralChunk(chunk, query, tokens, signals, params.refinement);
  const scored = params.chunks
    .map((chunk) => {
      const pathText = chunk.relativePath.toLowerCase();
      const preferredBoost = params.overrides?.preferredPaths?.some((prefix) =>
        pathText.includes(prefix.toLowerCase()),
      )
        ? 36
        : 0;
      const discouragedPenalty = params.overrides?.discouragedPaths?.some((prefix) =>
        pathText.includes(prefix.toLowerCase()),
      )
        ? 42
        : 0;
      return {
        chunk,
        score:
          scoreChunkForBucket(chunk, query, scoringTokens, signals) +
          preferredBoost -
          discouragedPenalty,
        strongOverlap: countUniqueTokenOverlap(chunk.tokens, strongTokens),
        coverageOverlap: countUniqueTokenOverlap(chunk.tokens, coverageTokens),
        tier: detectDocTier(pathText),
        basenameStem: getBasenameStem(pathText),
        pathPlatforms: getPathPlatforms(pathText),
      };
    })
    .filter((entry) => entry.score > 0)
    .map((entry, _index, all) => {
      // When multiple chunks share the same basename, prefer the stronger tier
      // and better platform match instead of letting partials crowd out the
      // primary page variant.
      const bestTierForBasename = all.reduce<DocTier>((best, candidate) => {
        if (candidate.basenameStem !== entry.basenameStem || candidate.score <= 0) {
          return best;
        }
        return getTierWeight(candidate.tier) > getTierWeight(best) ? candidate.tier : best;
      }, entry.tier);
      const tierGap = getTierWeight(bestTierForBasename) - getTierWeight(entry.tier);
      const bestPlatformMatchForBasename = all.reduce(
        (best, candidate) => {
          if (candidate.basenameStem !== entry.basenameStem || candidate.score <= 0) {
            return best;
          }
          return Math.max(best, countMatchingPlatforms(candidate.pathPlatforms, signals.platforms));
        },
        countMatchingPlatforms(entry.pathPlatforms, signals.platforms),
      );
      const platformGap =
        bestPlatformMatchForBasename -
        countMatchingPlatforms(entry.pathPlatforms, signals.platforms);
      return {
        ...entry,
        score:
          entry.score -
          Math.max(0, tierGap) * 16 -
          Math.max(0, platformGap) * 18 +
          entry.strongOverlap * 4,
      };
    });

  const bestStrongOverlap = scored.reduce((best, entry) => Math.max(best, entry.strongOverlap), 0);
  const bestCoverageOverlap = scored.reduce(
    (best, entry) => Math.max(best, entry.coverageOverlap),
    0,
  );
  const bestScore = scored.reduce((best, entry) => Math.max(best, entry.score), 0);
  // Bail out when we only found weak fuzzy matches and none of the stronger
  // terms appear in the candidate set. This is what blocks infra questions
  // from drifting into random SDK quickstarts.
  if (strongTokens.length > 0 && bestStrongOverlap === 0 && bestScore < 45) {
    return [];
  }
  if (coverageTokens.length > 0 && bestCoverageOverlap === 0 && bestScore < 90) {
    return [];
  }

  return scored.toSorted((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.chunk.relativePath !== b.chunk.relativePath) {
      return a.chunk.relativePath.localeCompare(b.chunk.relativePath);
    }
    return a.chunk.startLine - b.chunk.startLine;
  });
}

function toBucketedHits(
  entries: ReturnType<typeof scoreBucketedEntries>,
  bucket: DocRetrievalBucket,
  limit: number,
  purpose?: RetrievalPurpose,
): DocSearchHit[] {
  return entries.slice(0, limit).map((entry) => ({
    ...toHit(entry.chunk, entry.score),
    retrievalBucket: bucket,
    retrievalPurpose: purpose,
  }));
}

export async function loadDocChunks(params?: {
  docsRoot?: string;
  dataDir?: string;
}): Promise<DocIndexChunk[]> {
  return await rebuildDocIndexIfNeeded({
    docsRoot: params?.docsRoot,
    dataDir: params?.dataDir,
  });
}

export function searchDocsForBucket(params: {
  chunks: DocIndexChunk[];
  question: string;
  bucket: DocRetrievalBucket;
  limit: number;
  purpose?: RetrievalPurpose;
  refinement?: {
    taskKind?: DocProceduralTaskKind;
    preferredDocShape?: DocPreferredDocShape;
  };
  overrides?: RetrievalOverrides;
}): DocSearchHit[] {
  return toBucketedHits(
    scoreBucketedEntries({
      chunks: params.chunks,
      question: params.question,
      bucket: params.bucket,
      refinement: params.refinement,
      overrides: params.overrides,
    }),
    params.bucket,
    params.limit,
    params.purpose,
  );
}

function buildPurposeQuery(params: {
  question: string;
  purpose: RetrievalPurpose;
  state?: QuestionState;
}): {
  question: string;
  bucket: DocRetrievalBucket;
  refinement?: {
    taskKind?: DocProceduralTaskKind;
    preferredDocShape?: DocPreferredDocShape;
  };
} {
  if (params.purpose === "overview") {
    const referent = params.state?.referent ?? params.question;
    return {
      question: `what is ${referent}`.trim(),
      bucket: "concept",
    };
  }
  if (params.purpose === "prerequisite") {
    const normalizedQuestion = normalizeSearchText(params.question);
    const quickstartHints =
      normalizedQuestion.includes("first message") ||
      normalizedQuestion.includes("quickstart") ||
      normalizedQuestion.includes("from scratch")
        ? "quickstart initialize connect setup"
        : normalizedQuestion.includes("import") || normalizedQuestion.includes("initialize")
          ? "import initialize quickstart setup"
          : "quickstart initialize connect setup";
    return {
      question: `${params.question} ${quickstartHints}`.trim(),
      bucket: "procedural",
      refinement: {
        taskKind: params.state?.taskKind ?? detectProceduralTaskKind(params.question),
        preferredDocShape:
          normalizedQuestion.includes("first message") ||
          normalizedQuestion.includes("quickstart") ||
          normalizedQuestion.includes("from scratch")
            ? "quickstart_step"
            : "specialized_task",
      },
    };
  }
  if (params.purpose === "api") {
    return {
      question: `${params.question} api`,
      bucket: "procedural",
      refinement: {
        taskKind: params.state?.taskKind ?? detectProceduralTaskKind(params.question),
        preferredDocShape: "specialized_task",
      },
    };
  }
  if (params.purpose === "primary_concept") {
    return {
      question: params.question,
      bucket: "concept",
    };
  }
  return {
    question: params.question,
    bucket: "procedural",
    refinement: {
      taskKind: params.state?.taskKind ?? detectProceduralTaskKind(params.question),
      preferredDocShape:
        params.state?.taskKind === "first_message" ? "quickstart_step" : "specialized_task",
    },
  };
}

export function searchDocsForPurpose(params: {
  chunks: DocIndexChunk[];
  question: string;
  purpose: RetrievalPurpose;
  state?: QuestionState;
  limit: number;
  overrides?: RetrievalOverrides;
}): DocSearchHit[] {
  const prepared = buildPurposeQuery({
    question: params.question,
    purpose: params.purpose,
    state: params.state,
  });
  return searchDocsForBucket({
    chunks: params.chunks,
    question: prepared.question,
    bucket: prepared.bucket,
    limit: params.limit,
    purpose: params.purpose,
    refinement: prepared.refinement,
    overrides: params.overrides,
  });
}

// Main retrieval entry used by `question-execution.ts`. It expands mixed questions into per-step
// searches, then merges the best concept/procedural hits back into a single ranked result list.
export async function searchDocs(params: {
  query: string;
  docsRoot?: string;
  dataDir?: string;
  maxResults?: number;
  refinement?: {
    taskKind?: DocProceduralTaskKind;
    preferredDocShape?: DocPreferredDocShape;
  };
  overrides?: RetrievalOverrides;
}): Promise<DocSearchHit[]> {
  const chunks = await loadDocChunks({
    docsRoot: params.docsRoot,
    dataDir: params.dataDir,
  });
  const plan = planDocQuestion(params.query);
  const maxResults = params.maxResults ?? 5;

  if (plan.kind === "concept" || plan.kind === "procedural") {
    return searchDocsForBucket({
      chunks,
      question: plan.steps[0]?.question ?? params.query,
      bucket: plan.kind,
      limit: maxResults,
      purpose: plan.kind === "concept" ? "primary_concept" : "primary_procedural",
      refinement: params.refinement,
      overrides: params.overrides,
    });
  }

  const merged: DocSearchHit[] = [];
  const seen = new Set<string>();
  const perBucketLimit = Math.max(2, maxResults);
  const bucketHitsByStep = plan.steps.map((step) => ({
    step,
    hits: searchDocsForBucket({
      chunks,
      question: step.question,
      bucket: step.intent,
      limit: perBucketLimit,
      purpose: step.intent === "concept" ? "primary_concept" : "primary_procedural",
      refinement: step.intent === "procedural" ? params.refinement : undefined,
      overrides: params.overrides,
    }),
  }));

  // Keep the best hit from each step first so mixed questions preserve both
  // the concept answer and the procedural answer instead of letting one bucket dominate.
  for (const entry of bucketHitsByStep) {
    const hit = entry.hits[0];
    if (!hit) {
      continue;
    }
    const key = `${hit.path}:${hit.startLine}:${hit.endLine}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(hit);
    }
  }

  for (let rank = 1; merged.length < maxResults; rank += 1) {
    let progressed = false;
    for (const entry of bucketHitsByStep) {
      const hit = entry.hits[rank];
      if (!hit) {
        continue;
      }
      progressed = true;
      const key = `${hit.path}:${hit.startLine}:${hit.endLine}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(hit);
      if (merged.length >= maxResults) {
        return merged;
      }
    }
    if (!progressed) {
      break;
    }
  }

  return merged.slice(0, maxResults);
}
