export const PLATFORM_TOKENS = [
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

export const PRODUCT_TOKENS = [
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

export const GENERIC_QUERY_TOKENS = new Set([
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

export const COVERAGE_STOP_TOKENS = new Set([
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

export function countTokenMatches(haystack: string, token: string): number {
  if (!haystack.includes(token)) {
    return 0;
  }
  const matches = haystack.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
  return Math.min(matches?.length ?? 0, 4);
}

export function normalizeSearchText(text: string): string {
  // Collapse common product, platform, and channel synonyms into a smaller
  // shared vocabulary so ranking logic can stay mostly string-based.
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

export function normalizeSnippet(text: string, maxLength = 220): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1)}...`;
}

export function countTokenOverlap(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  let overlap = 0;
  for (const token of left) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

export function countUniqueTokenOverlap(left: string[], right: string[]): number {
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

export function getStrongQueryTokens(tokens: string[]): string[] {
  return tokens.filter((token) => token.length >= 4 && !GENERIC_QUERY_TOKENS.has(token));
}

export function getCoverageCriticalQueryTokens(tokens: string[]): string[] {
  // Coverage gating should ignore broad SDK nouns and focus on the terms that
  // actually distinguish whether docs cover the user's question.
  return tokens.filter(
    (token) =>
      token.length >= 4 && !GENERIC_QUERY_TOKENS.has(token) && !COVERAGE_STOP_TOKENS.has(token),
  );
}
