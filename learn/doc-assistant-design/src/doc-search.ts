import type { DocCitation, DocSearchHit } from "./protocol/index.js";
import { buildDocIndex, tokenize, type DocIndexChunk } from "./doc-index.js";

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

type DocTier = "primary" | "partial" | "archive";
type QueryIntent =
  | "start"
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

type QueryChannelKind = "direct" | "group" | "community";

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
    .replace(/\bjavascript\b/g, "web")
    .replace(/\bjs\b/g, "web")
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

function detectQuerySignals(query: string, tokens: string[]): {
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
    normalizedQuery.includes("private subchannel") ||
    normalizedQuery.includes("open channel")
  ) {
    kinds.add("community");
  }
  return Array.from(kinds);
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
  if (pathText.includes("/.archive/")) {
    return "archive";
  }
  if (pathText.includes("/partials/")) {
    return "partial";
  }
  return "primary";
}

function getTierWeight(tier: DocTier): number {
  if (tier === "primary") {
    return 3;
  }
  if (tier === "partial") {
    return 2;
  }
  return 1;
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
  if (signals.normalizedQuery.includes("push settings") || signals.normalizedQuery.includes("push config")) {
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
  boost("connect", ["connect", "connection", "login", "log in", "sign in", "authenticate"], 22, 8);
  boost("accept", ["accept", "answer", "receive and accept"], 18, 6);
  boost("configure", ["configure", "config", "settings", "properties", "field descriptions"], 16, 5);
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
  if (tier === "archive") {
    score -= 18;
  }
  if (tier === "partial") {
    score -= 12;
  }

  if (signals.platforms.length > 0) {
    const pathPlatforms = PLATFORM_TOKENS.filter((token) => pathText.includes(token));
    for (const platform of signals.platforms) {
      if (pathPlatforms.includes(platform)) {
        score += 22;
      }
    }
    for (const platform of pathPlatforms) {
      if (!signals.platforms.includes(platform)) {
        score -= 12;
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

  if (signals.products.includes("callsdk")) {
    if (
      normalizedPath.includes("chatsdk") ||
      normalizedPath.includes("platform chat api") ||
      normalizedPath.includes("group channel")
    ) {
      score -= 36;
    }
  }
  if (signals.intents.includes("release") && normalizedPath.includes("release notes")) {
    score += 24;
  }
  if (!signals.normalizedQuery.includes("open channel") && normalizedPath.includes("open channel")) {
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
  if (normalizedHeading.includes("set up webhook") || normalizedHeading.includes("set up webhooks")) {
    score += 34;
  }
  if (normalizedHeading.includes("verify signature") || normalizedHeading.includes("verify signatures")) {
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
  if (!signals.normalizedQuery.includes("open channel") && normalizedPath.includes("open channel")) {
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
  if (normalizedHeading.includes("direct channel") || normalizedHeading.includes("channel overview")) {
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
    (normalizedPath.includes("/import") || normalizedPath.includes("/init") || normalizedHeading.includes("initialize") || normalizedHeading.includes("import"))
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
    signals.normalizedQuery.includes("release notes") &&
    normalizedHeading.includes("new features")
  ) {
    score += 14;
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
  if (normalizedBody.includes("sync to the sender") || normalizedBody.includes("sync the message")) {
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
  if (normalizedHeading.includes("default behaviors") || normalizedHeading.includes("channel management")) {
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
    if (normalizedPath.includes("community channel") || normalizedPath.includes("community channels")) {
      score += 34;
    }
    if (
      normalizedHeading.includes("create a community channel") ||
      normalizedHeading.includes("create a subchannel") ||
      normalizedBody.includes("private subchannel")
    ) {
      score += 24;
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
    if (normalizedPath.includes("community channel") || normalizedHeading.includes("private subchannel")) {
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

function scoreChunk(
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
  if (query && (pathText.includes(query) || headingText.includes(query) || bodyText.includes(query))) {
    score += 8;
  }
  for (const token of tokens) {
    score += countTokenMatches(pathText, token) * 5;
    score += countTokenMatches(headingText, token) * 4;
    score += countTokenMatches(bodyText, token);
  }
  score += scorePathSemantics(pathText, headingText, signals);
  score += scoreBasenameSemantics(basenameStem, headingText, signals);
  score += scoreHeadingIntent(headingText, bodyText, signals);
  score += scoreClientChatStartSemantics(pathText, headingText, bodyText, signals);
  score += scoreClientConnectionSemantics(pathText, headingText, bodyText, signals);
  score += scoreWebhookSemantics(pathText, headingText, bodyText, signals);
  score += scoreChannelCreationSemantics(pathText, headingText, bodyText, signals);
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

export async function searchDocs(params: {
  query: string;
  docsRoot?: string;
  dataDir?: string;
  maxResults?: number;
}): Promise<DocSearchHit[]> {
  const chunks = await buildDocIndex({
    docsRoot: params.docsRoot,
    dataDir: params.dataDir,
  });
  const query = params.query.trim().toLowerCase();
  const tokens = expandQueryTokens(query, tokenize(query));
  const scoringTokens = tokens.filter((token) => !GENERIC_QUERY_TOKENS.has(token));
  const strongTokens = getStrongQueryTokens(tokens);
  const signals = detectQuerySignals(query, tokens);
  const scored = chunks
    .map((chunk) => {
      const pathText = chunk.relativePath.toLowerCase();
      return {
        chunk,
        score: scoreChunk(chunk, query, scoringTokens, signals),
        strongOverlap: countUniqueTokenOverlap(chunk.tokens, strongTokens),
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
      const bestPlatformMatchForBasename = all.reduce((best, candidate) => {
        if (candidate.basenameStem !== entry.basenameStem || candidate.score <= 0) {
          return best;
        }
        return Math.max(best, countMatchingPlatforms(candidate.pathPlatforms, signals.platforms));
      }, countMatchingPlatforms(entry.pathPlatforms, signals.platforms));
      const platformGap =
        bestPlatformMatchForBasename - countMatchingPlatforms(entry.pathPlatforms, signals.platforms);
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
  const bestScore = scored.reduce((best, entry) => Math.max(best, entry.score), 0);
  if (strongTokens.length > 0 && bestStrongOverlap === 0 && bestScore < 45) {
    return [];
  }

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.chunk.relativePath !== b.chunk.relativePath) {
        return a.chunk.relativePath.localeCompare(b.chunk.relativePath);
      }
      return a.chunk.startLine - b.chunk.startLine;
    })
    .slice(0, params.maxResults ?? 5)
    .map((entry) => toHit(entry.chunk, entry.score));
}
