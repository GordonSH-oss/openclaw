import { rebuildDocIndexIfNeeded, tokenize, type DocIndexChunk } from "./doc-index.js";
import type { DocCitation, DocSearchHit } from "./protocol/index.js";
import type { QuestionState } from "./question-state.js";
import type { RetrievalPurpose } from "./retrieval-plan.js";

const PLATFORM_TOKENS = [
  "ios",
  "android",
  "web",
  "javascript",
  "js",
  "flutter",
  "windows",
  "linux",
  "mac",
  "macos",
];

const PRODUCT_TOKENS = [
  "chatsdk",
  "chatui",
  "callplus",
  "callsdk",
  "calllib",
  "callkit",
  "imlib",
  "imkit",
  "chat",
  "server",
];

type DocTier = "primary" | "partial";
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
export type DocQuestionIntent = "concept" | "procedural";
export type DocQuestionPlanKind = DocQuestionIntent | "mixed";
export type DocRetrievalBucket = "concept" | "procedural";
export type DocSearchDocShape =
  | "quickstart_step"
  | "specialized_task"
  | "overview"
  | "generic_reference";
export type DocProceduralTaskKind =
  | "first_message"
  | "send_message"
  | "start_chat"
  | "channel_creation"
  | "generic";
export type DocPreferredDocShape = "quickstart_step" | "specialized_task";
export type RetrievalOverrides = {
  preferredPaths?: string[];
  discouragedPaths?: string[];
};
export type DocQuestionPlanStep = {
  intent: DocQuestionIntent;
  question: string;
  order: number;
};
export type DocQuestionPlan = {
  kind: DocQuestionPlanKind;
  steps: DocQuestionPlanStep[];
};

const GENERIC_QUERY_TOKENS = new Set([
  "a",
  "an",
  "and",
  "answer",
  "call",
  "configure",
  "for",
  "how",
  "i",
  "in",
  "is",
  "it",
  "just",
  "know",
  "let",
  "me",
  "of",
  "sdk",
  "settings",
  "show",
  "the",
  "this",
  "to",
  "up",
  "use",
  "what",
]);

const COVERAGE_STOP_TOKENS = new Set([
  "android",
  "api",
  "call",
  "callsdk",
  "channel",
  "channels",
  "chat",
  "chatsdk",
  "client",
  "community",
  "config",
  "configure",
  "connect",
  "connection",
  "create",
  "default",
  "direct",
  "first",
  "flutter",
  "group",
  "initialize",
  "ios",
  "language",
  "locale",
  "localization",
  "message",
  "messages",
  "notification",
  "notifications",
  "open",
  "platform",
  "preference",
  "push",
  "quickstart",
  "sdk",
  "send",
  "server",
  "settings",
  "setup",
  "start",
  "targeted",
  "web",
]);

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

const REFERENCE_PRONOUN_PATTERNS = [
  /\bit\b/giu,
  /\bthis\b/giu,
  /\bthat\b/giu,
  /\bthem\b/giu,
  /\bthese\b/giu,
  /\bthose\b/giu,
  /它/gu,
  /它们/gu,
  /这个/gu,
  /那个/gu,
  /这些/gu,
  /那些/gu,
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

function countTokenMatches(haystack: string, token: string): number {
  if (!haystack.includes(token)) {
    return 0;
  }
  const matches = haystack.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
  return Math.min(matches?.length ?? 0, 4);
}

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bchat\s+sdk\b/g, "chatsdk")
    .replace(/\bcall\s+sdk\b/g, "callsdk")
    .replace(/\bchat\s+ui\b/g, "chatui")
    .replace(/\bcall\s+plus\b/g, "callplus")
    .replace(/\bjavascript\b/g, "web")
    .replace(/\bjs\b/g, "web")
    .replace(/\blanguages\b/g, "language")
    .replace(/\blocalisation\b/g, "localization")
    .replace(/\bset\s+up\b/g, "setup")
    .replace(/\bsub[\s\-_/]*channels?\b/g, "subchannel")
    .replace(/\bprivate[\s\-_/]*sub[\s\-_/]*channels?\b/g, "private subchannel")
    .replace(/\b1[\s\-_/]*to[\s\-_/]*1\b/g, "one to one")
    .replace(/\b1[\s\-_/]*on[\s\-_/]*1\b/g, "one to one")
    .replace(/\bdms?\b/g, "direct channel")
    .replace(/\bdirect messages?\b/g, "direct channel")
    .replace(/\bprivate messages?\b/g, "direct channel")
    .replace(/\bdirect chats?\b/g, "direct channel")
    .replace(/\bprivate chats?\b/g, "direct channel")
    .replace(/\bcommunity chats?\b/g, "community channel")
    .replace(/\bsingle chats?\b/g, "direct channel")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ")
    .trim();
}

function normalizeSnippet(text: string, maxLength = 220): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1)}…`;
}

function trimQuestionSegment(text: string): string {
  return text
    .trim()
    .replace(/^[,;:，；：]+/u, "")
    .replace(/[?？!！.。]+$/u, "")
    .trim();
}

function splitQuestionIntoSegments(question: string): string[] {
  const normalized = question
    .replace(/([?？])/gu, "$1\n")
    .replace(/\b(and then|then)\b/giu, "\n")
    .replace(/((?:what(?:'s| is| are)?|define|explain)\b[^?\n]{0,200}?)(\bhow to\b)/iu, "$1\n$2")
    .replace(/(是什么[^?\n]{0,200}?)(如何|怎么|创建)/gu, "$1\n$2");
  const segments = normalized
    .split(/\n+/)
    .map((part) => trimQuestionSegment(part))
    .filter(Boolean);
  return segments.length > 0 ? segments : [trimQuestionSegment(question)].filter(Boolean);
}

function extractQuestionReferent(question: string): string | undefined {
  const trimmed = trimQuestionSegment(question);
  if (!trimmed) {
    return undefined;
  }

  const normalized = normalizeSearchText(trimmed);
  const prioritizedPhrases = [
    "community channel",
    "subchannel",
    "group channel",
    "direct channel",
    "offline messages",
    "webhook",
    "push notification",
  ];
  const prioritized = prioritizedPhrases.find((phrase) => normalized.includes(phrase));
  if (prioritized) {
    return prioritized;
  }

  const stripped = trimmed
    .replace(/^(?:what(?:'s| is| are)?|define|definition of|explain|about)\s+/iu, "")
    .replace(/^(?:什么是|什么叫|请解释(?:一下)?|解释一下|介绍(?:一下)?|关于)\s*/u, "")
    .replace(/^(?:a|an|the)\s+/iu, "")
    .replace(/[?？!！.。]+$/u, "")
    .trim();
  return stripped || undefined;
}

function hasReferencePronoun(question: string): boolean {
  return REFERENCE_PRONOUN_PATTERNS.some((pattern) =>
    new RegExp(pattern.source, pattern.flags).test(question),
  );
}

function rewriteQuestionWithReferent(question: string, referent: string): string {
  let rewritten = question;
  for (const pattern of REFERENCE_PRONOUN_PATTERNS) {
    rewritten = rewritten.replace(pattern, referent);
  }
  return rewritten.replace(/\s+/g, " ").trim();
}

function inheritReferentsAcrossSegments(rawSteps: string[]): string[] {
  const steps: string[] = [];
  let lastConceptReferent: string | undefined;

  for (const rawStep of rawSteps) {
    const intent = detectQuestionIntentForSegment(rawStep);
    let stepQuestion = rawStep;
    if (intent === "concept") {
      lastConceptReferent = extractQuestionReferent(rawStep) ?? lastConceptReferent;
    } else if (lastConceptReferent && hasReferencePronoun(rawStep)) {
      const normalizedReferent = normalizeSearchText(lastConceptReferent);
      if (normalizedReferent && !normalizeSearchText(rawStep).includes(normalizedReferent)) {
        stepQuestion = rewriteQuestionWithReferent(rawStep, lastConceptReferent);
      }
    }
    steps.push(stepQuestion);
  }

  return steps;
}

function detectQuestionIntentForSegment(question: string): DocQuestionIntent {
  const normalized = normalizeSearchText(question);
  if (PROCEDURAL_QUERY_MARKERS.some((marker) => normalized.includes(marker))) {
    return "procedural";
  }
  if (CONCEPT_QUERY_MARKERS.some((marker) => normalized.includes(marker))) {
    return "concept";
  }
  if (normalized.split(" ").length <= 5 && !normalized.includes("sdk")) {
    return "concept";
  }
  return "procedural";
}

export function planDocQuestion(question: string): DocQuestionPlan {
  const rawSteps = inheritReferentsAcrossSegments(splitQuestionIntoSegments(question));
  const steps = rawSteps.map((stepQuestion, index) => ({
    question: stepQuestion,
    intent: detectQuestionIntentForSegment(stepQuestion),
    order: index,
  }));
  const uniqueIntents = new Set(steps.map((step) => step.intent));
  return {
    kind: uniqueIntents.size > 1 ? "mixed" : (steps[0]?.intent ?? "procedural"),
    steps,
  };
}

export function detectProceduralTaskKind(question: string): DocProceduralTaskKind {
  const normalized = normalizeSearchText(question);
  const mentionsChannel =
    normalized.includes("channel") ||
    normalized.includes("conversation") ||
    normalized.includes("chat") ||
    normalized.includes("community") ||
    normalized.includes("subchannel");
  const mentionsMessage =
    normalized.includes("message") ||
    normalized.includes("text") ||
    normalized.includes("image") ||
    normalized.includes("file") ||
    normalized.includes("voice") ||
    normalized.includes("media") ||
    normalized.includes("targeted");

  if (
    normalized.includes("create") &&
    (mentionsChannel || normalized.includes("group") || normalized.includes("community"))
  ) {
    return "channel_creation";
  }
  if (
    normalized.includes("first message") ||
    normalized.includes("my first message") ||
    normalized.includes("your first message")
  ) {
    return "first_message";
  }
  if (normalized.includes("send") && mentionsMessage) {
    return "send_message";
  }
  if (
    normalized.includes("start") ||
    normalized.includes("begin") ||
    normalized.includes("open") ||
    (normalized.includes("chat") && !normalized.includes("wechat"))
  ) {
    return "start_chat";
  }
  return "generic";
}

export function detectPreferredDocShape(question: string): DocPreferredDocShape {
  const normalized = normalizeSearchText(question);
  if (
    normalized.includes("quickstart") ||
    normalized.includes("getting started") ||
    normalized.includes("get started") ||
    normalized.includes("from scratch") ||
    normalized.includes("tutorial")
  ) {
    return "quickstart_step";
  }
  return "specialized_task";
}

export function detectDocShape(
  hit: Pick<DocSearchHit, "path" | "heading" | "text">,
): DocSearchDocShape {
  const normalizedPath = normalizeSearchText(hit.path);
  const normalizedHeading = normalizeSearchText(hit.heading ?? "");
  const normalizedBody = normalizeSearchText(hit.text.slice(0, 500));
  const combined = `${normalizedPath} ${normalizedHeading}`.trim();
  const quickstartPage =
    normalizedPath.includes("quickstart") ||
    normalizedPath.includes("getting started") ||
    normalizedPath.includes("get started") ||
    normalizedHeading.includes("quickstart") ||
    normalizedHeading.includes("getting started") ||
    normalizedHeading.includes("get started");
  const stepHeading =
    /\bstep\s+\d+\b/.test(normalizedHeading) ||
    normalizedHeading.startsWith("step ") ||
    normalizedHeading.includes("send your first message") ||
    normalizedHeading.includes("send a message");
  const specializedPath =
    normalizedPath.includes("/message/send") ||
    normalizedPath.includes("/connection/connect") ||
    normalizedPath.includes("/community channels/creating channel") ||
    normalizedPath.includes("/community-channels/creating-channel") ||
    normalizedPath.includes("/group channels/") ||
    normalizedPath.includes("/group-channels/") ||
    normalizedPath.includes("/direct system channels/") ||
    normalizedPath.includes("/direct-system-channels/");
  const specializedHeading =
    normalizedHeading.includes("send a text message") ||
    normalizedHeading.includes("send a regular message") ||
    normalizedHeading.includes("send an image message") ||
    normalizedHeading.includes("send a file message") ||
    normalizedHeading.includes("send a voice message") ||
    normalizedHeading.includes("send a media message") ||
    normalizedHeading.includes("send a targeted message") ||
    normalizedHeading.includes("connect") ||
    normalizedHeading.includes("create a group") ||
    normalizedHeading.includes("creating community channels");

  if (
    combined.includes("overview") ||
    combined.includes("/about") ||
    normalizedHeading.includes("about ") ||
    normalizedHeading.includes("glossary")
  ) {
    return "overview";
  }
  if (quickstartPage && (stepHeading || normalizedBody.includes("for details"))) {
    return "quickstart_step";
  }
  if (specializedPath || specializedHeading) {
    return "specialized_task";
  }
  return "generic_reference";
}

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
  if (hasToken("end") || hasToken("hang up") || hasToken("hangup") || hasToken("reject")) {
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

function detectDocTier(pathText: string): DocTier {
  if (pathText.includes("/partials/")) {
    return "partial";
  }
  return "primary";
}

function getTierWeight(tier: DocTier): number {
  if (tier === "primary") {
    return 3;
  }
  return 2;
}

function getBasenameStem(pathText: string): string {
  const filename = pathText.split("/").at(-1) ?? pathText;
  return normalizeSearchText(filename.replace(/\.(md|mdx)$/i, ""));
}

function getPathPlatforms(pathText: string): string[] {
  return PLATFORM_TOKENS.filter((token) => pathText.includes(token));
}

function countMatchingPlatforms(pathPlatforms: string[], queryPlatforms: string[]): number {
  if (queryPlatforms.length === 0) {
    return 0;
  }
  const querySet = new Set(queryPlatforms);
  let matches = 0;
  for (const platform of pathPlatforms) {
    if (querySet.has(platform)) {
      matches += 1;
    }
  }
  return matches;
}

function countTokenOverlap(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  let overlap = 0;
  for (const token of left) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function countUniqueTokenOverlap(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let overlap = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function getStrongQueryTokens(tokens: string[]): string[] {
  return tokens.filter((token) => token.length >= 4 && !GENERIC_QUERY_TOKENS.has(token));
}

function getCoverageCriticalQueryTokens(tokens: string[]): string[] {
  return tokens.filter(
    (token) =>
      token.length >= 4 && !GENERIC_QUERY_TOKENS.has(token) && !COVERAGE_STOP_TOKENS.has(token),
  );
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
  boost("end", ["end", "reject", "hang up"], 12, 4);
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

  let score = 0;

  if (wantsDirect) {
    if (normalizedPath.includes("direct system channels")) {
      score += generic ? 34 : 48;
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
