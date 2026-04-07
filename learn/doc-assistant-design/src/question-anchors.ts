import { normalizeSearchText } from "./search-text.js";

export type QuestionAnchors = {
  verbPhrases: string[];
  nounPhrases: string[];
  qualifiers: string[];
  constraints: string[];
  apiSymbols: string[];
  unknownTerms: string[];
};

const VERB_PATTERNS: Array<{ phrase: string; patterns: RegExp[] }> = [
  {
    phrase: "accept call",
    patterns: [/\baccept(?:\s+\w+){0,3}\s+call\b/giu, /接听(?:\w{0,6})通话/gu],
  },
  {
    phrase: "add reaction",
    patterns: [/\b(?:add|send|use)(?:\s+\w+){0,3}\s+reactions?\b/giu, /添加表情|发送表情/gu],
  },
  { phrase: "answer call", patterns: [/\banswer(?:\s+\w+){0,3}\s+call\b/giu, /接(?:听|通)通话/gu] },
  { phrase: "check", patterns: [/\bcheck\b/giu, /检查|查看/gu] },
  { phrase: "configure", patterns: [/\bconfig(?:ure)?\b/giu, /配置|设置/gu] },
  { phrase: "connect", patterns: [/\bconnect(?:ion)?\b/giu, /连接/gu] },
  { phrase: "create", patterns: [/\bcreate\b/giu, /创建/gu] },
  { phrase: "delete", patterns: [/\b(?:delete|remove|destroy)\b/giu, /删除|移除|销毁/gu] },
  { phrase: "forward", patterns: [/\bforward\b/giu, /转发/gu] },
  { phrase: "integrate", patterns: [/\b(?:integrate|integration)\b/giu, /集成|接入/gu] },
  { phrase: "initialize", patterns: [/\b(?:init|initialize)\b/giu, /初始化/gu] },
  { phrase: "issue", patterns: [/\bissue\b/giu, /签发|发放/gu] },
  { phrase: "join", patterns: [/\bjoin\b/giu, /加入/gu] },
  { phrase: "leave", patterns: [/\bleave\b/giu, /离开|退出/gu] },
  {
    phrase: "list",
    patterns: [/\b(?:list|load|query|retrieve|fetch)\b/giu, /查询|拉取|获取|加载/gu],
  },
  { phrase: "mention", patterns: [/\bmention(?:s|ed|ing)?\b/giu, /提及|艾特|@所有人|@everyone/gu] },
  { phrase: "mute", patterns: [/\bmute\b/giu, /静音|免打扰/gu] },
  { phrase: "pin", patterns: [/\bpin(?:ned|ning)?\b/giu, /置顶/gu] },
  { phrase: "react", patterns: [/\breact(?:ion|ions)?\b/giu, /反应|表情回应/gu] },
  { phrase: "recall", patterns: [/\b(?:recall|revoke|unsend|withdraw)\b/giu, /撤回/gu] },
  { phrase: "send", patterns: [/\bsend\b/giu, /发送/gu] },
  { phrase: "start", patterns: [/\b(?:start|begin|open)\b/giu, /开始|发起|打开/gu] },
  { phrase: "thread", patterns: [/\bthread(?:s|ed)?\b/giu, /话题|线程/gu] },
  { phrase: "unmute", patterns: [/\bunmute\b/giu, /取消静音/gu] },
  { phrase: "unpin", patterns: [/\bunpin\b/giu, /取消置顶/gu] },
  { phrase: "update", patterns: [/\b(?:update|change|set)\b/giu, /修改|更新|设置/gu] },
  { phrase: "verify", patterns: [/\bverify|validation\b/giu, /校验|验证/gu] },
];

const NOUN_PATTERNS: Array<{ phrase: string; patterns: RegExp[] }> = [
  {
    phrase: "access token",
    patterns: [
      /\baccess tokens?\b/giu,
      /\btokens?\b/giu,
      /\bauth(?:entication)?\b/giu,
      /令牌|鉴权|认证|token/gu,
    ],
  },
  { phrase: "api endpoint", patterns: [/\bapi endpoints?\b/giu, /接口地址|接口端点/gu] },
  { phrase: "call", patterns: [/\bcall\b/giu, /通话/gu] },
  { phrase: "channel", patterns: [/\bchannels?\b/giu, /频道/gu] },
  { phrase: "community channel", patterns: [/\bcommunity channels?\b/giu, /社区频道/gu] },
  { phrase: "conversation", patterns: [/\bconversations?\b/giu, /会话/gu] },
  {
    phrase: "direct channel",
    patterns: [/\bdirect channels?\b/giu, /\bdirectchannel\b/giu, /\bone to one\b/giu, /单聊/gu],
  },
  { phrase: "forwarded message", patterns: [/\bforward(?:ed)? messages?\b/giu, /转发消息/gu] },
  {
    phrase: "group channel",
    patterns: [/\bgroup channels?\b/giu, /\bgroupchannel\b/giu, /群聊/gu],
  },
  { phrase: "mention", patterns: [/\bmentions?\b/giu, /提及|艾特/gu] },
  { phrase: "message", patterns: [/\bmessages?\b/giu, /消息/gu] },
  {
    phrase: "message thread",
    patterns: [/\bmessage threads?\b/giu, /\bthreads?\b/giu, /话题|线程/gu],
  },
  { phrase: "moderator", patterns: [/\bmoderators?\b/giu, /管理员|版主/gu] },
  { phrase: "notification", patterns: [/\bnotifications?\b/giu, /通知/gu] },
  {
    phrase: "open channel",
    patterns: [/\bopen channels?\b/giu, /\bopenchannel\b/giu, /开放频道/gu],
  },
  { phrase: "permission", patterns: [/\bpermissions?\b/giu, /权限/gu] },
  { phrase: "reaction", patterns: [/\breactions?\b/giu, /表情回应|反应/gu] },
  { phrase: "sender metadata", patterns: [/\bsender metadata\b/giu, /发送者元数据/gu] },
  { phrase: "signature", patterns: [/\bsignatures?\b/giu, /签名/gu] },
  { phrase: "user", patterns: [/\busers?\b/giu, /用户/gu] },
  { phrase: "webhook", patterns: [/\bwebhooks?\b/giu, /回调|webhook/giu] },
  {
    phrase: "webhook signature",
    patterns: [/\bwebhook signatures?\b/giu, /webhook 签名|回调签名/gu],
  },
];

const QUALIFIER_PATTERNS: Array<{ phrase: string; patterns: RegExp[] }> = [
  { phrase: "default", patterns: [/\bdefault\b/giu, /默认/gu] },
  { phrase: "for everyone", patterns: [/\bfor everyone\b/giu, /所有人/gu] },
  { phrase: "for self only", patterns: [/\bfor self only\b/giu, /仅自己可见|仅自己/gu] },
  { phrase: "for moderators only", patterns: [/\bfor moderators only\b/giu, /仅管理员|仅版主/gu] },
  { phrase: "in thread", patterns: [/\bin threads?\b/giu, /在线程中|在话题中/gu] },
  { phrase: "on notification click", patterns: [/\bon notification click\b/giu, /通知点击/gu] },
  { phrase: "sender metadata", patterns: [/\bsender metadata\b/giu, /发送者元数据/gu] },
];

const CONSTRAINT_PATTERNS: Array<{ phrase: string; patterns: RegExp[] }> = [
  { phrase: "admin permission", patterns: [/\badmin permissions?\b/giu, /管理员权限/gu] },
  { phrase: "permission", patterns: [/\bpermissions?\b/giu, /权限/gu] },
  {
    phrase: "signature verification",
    patterns: [/\bsignature verification\b/giu, /签名校验|签名验证/gu],
  },
  { phrase: "verification", patterns: [/\bverification\b/giu, /验证|校验/gu] },
  { phrase: "version", patterns: [/\bversion\b/giu, /版本/gu] },
  { phrase: "language", patterns: [/\blanguage\b/giu, /语言/gu] },
  { phrase: "locale", patterns: [/\blocale\b/giu, /地区|语言环境/gu] },
];

const API_SYMBOL_PATTERN =
  /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+\b|\b[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]+)+\b|`([^`]+)`/gu;

const STOP_TERMS = new Set([
  "about",
  "android",
  "and",
  "api",
  "apis",
  "call",
  "can",
  "channel",
  "chat",
  "client",
  "default",
  "direct",
  "do",
  "does",
  "flutter",
  "for",
  "how",
  "i",
  "in",
  "ios",
  "is",
  "message",
  "notification",
  "on",
  "or",
  "sdk",
  "server",
  "the",
  "to",
  "web",
  "what",
  "with",
  "using",
  "yourself",
]);

const GENERIC_UNKNOWN_FOCUS_TERMS = new Set([
  "callsdk",
  "chatsdk",
  "auth",
  "constraint",
  "constraints",
  "detail",
  "details",
  "docs",
  "documentation",
  "exact",
  "flow",
  "guide",
  "guides",
  "management",
  "need",
  "operation",
  "operations",
  "specific",
  "task",
  "tasks",
  "want",
]);

function dedupe(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).filter(Boolean);
}

function pushMatches(
  target: string[],
  text: string,
  rules: Array<{ phrase: string; patterns: RegExp[] }>,
): void {
  for (const rule of rules) {
    if (rule.patterns.some((pattern) => new RegExp(pattern.source, pattern.flags).test(text))) {
      target.push(rule.phrase);
    }
  }
}

function extractApiSymbols(question: string): string[] {
  const matches = new Set<string>();
  for (const match of question.matchAll(API_SYMBOL_PATTERN)) {
    const value = (match[1] ?? match[0] ?? "").trim();
    if (!value) {
      continue;
    }
    if (value.length < 3) {
      continue;
    }
    matches.add(value.replace(/^`|`$/g, ""));
  }
  return Array.from(matches);
}

function tokenizeUnknownTerms(normalizedQuestion: string, knownTerms: Set<string>): string[] {
  return dedupe(
    normalizedQuestion
      .split(/\s+/)
      .filter((token) => token.length >= 4)
      .filter((token) => !STOP_TERMS.has(token))
      .filter((token) => !knownTerms.has(token)),
  ).slice(0, 8);
}

export function extractQuestionAnchors(question: string): QuestionAnchors {
  const normalized = normalizeSearchText(question);
  const verbPhrases: string[] = [];
  const nounPhrases: string[] = [];
  const qualifiers: string[] = [];
  const constraints: string[] = [];

  pushMatches(verbPhrases, normalized, VERB_PATTERNS);
  pushMatches(nounPhrases, normalized, NOUN_PATTERNS);
  pushMatches(qualifiers, normalized, QUALIFIER_PATTERNS);
  pushMatches(constraints, normalized, CONSTRAINT_PATTERNS);

  const apiSymbols = extractApiSymbols(question);
  const knownTerms = new Set<string>();
  for (const value of [...verbPhrases, ...nounPhrases, ...qualifiers, ...constraints]) {
    for (const token of normalizeSearchText(value).split(/\s+/)) {
      if (token) {
        knownTerms.add(token);
      }
    }
  }
  const unknownTerms = tokenizeUnknownTerms(normalized, knownTerms);

  const dedupedNouns = dedupe(nounPhrases);

  return {
    verbPhrases: dedupe(verbPhrases),
    nounPhrases: dedupedNouns,
    qualifiers: dedupe(qualifiers),
    constraints: dedupe(constraints),
    apiSymbols,
    unknownTerms,
  };
}

export function summarizeAnchorFocus(anchors: QuestionAnchors): string[] {
  return dedupe([
    ...anchors.nounPhrases,
    ...anchors.qualifiers,
    ...anchors.apiSymbols,
    ...selectSpecificUnknownTerms(anchors),
  ]);
}

export function selectSpecificUnknownTerms(anchors: QuestionAnchors): string[] {
  return anchors.unknownTerms.filter(
    (term) => term.length >= 4 && !GENERIC_UNKNOWN_FOCUS_TERMS.has(term) && !/^\d+$/.test(term),
  );
}

export function selectRequiredAnchors(state: {
  intent: "concept" | "procedural" | "mixed";
  anchors: QuestionAnchors;
}): string[] {
  const genericVerbs = new Set([
    "configure",
    "create",
    "integrate",
    "initialize",
    "list",
    "send",
    "start",
    "update",
  ]);
  const required = [
    ...state.anchors.nounPhrases,
    ...state.anchors.constraints,
    ...state.anchors.apiSymbols,
    ...state.anchors.qualifiers.filter((qualifier) => qualifier !== "default"),
  ];
  if (state.intent !== "concept") {
    required.push(...state.anchors.verbPhrases.filter((verb) => !genericVerbs.has(verb)));
    required.push(...selectSpecificUnknownTerms(state.anchors));
  } else if (required.length === 0) {
    required.push(...selectSpecificUnknownTerms(state.anchors));
  }
  return dedupe(required);
}

const BROAD_INTEGRATION_TERMS = [
  "integrate",
  "integration",
  "install",
  "set up",
  "setup",
  "集成",
  "接入",
];

function hasSpecificTaskFocus(anchors: QuestionAnchors): boolean {
  return (
    anchors.nounPhrases.length > 0 ||
    anchors.constraints.length > 0 ||
    anchors.apiSymbols.length > 0 ||
    anchors.qualifiers.length > 0 ||
    selectSpecificUnknownTerms(anchors).length > 0
  );
}

export function isBroadIntegrationRequest(state: {
  rawQuestion: string;
  normalizedQuestion?: string;
  intent: "concept" | "procedural" | "mixed";
  anchors: QuestionAnchors;
}): boolean {
  if (state.intent === "concept") {
    return false;
  }
  const normalized = state.normalizedQuestion ?? normalizeSearchText(state.rawQuestion);
  const mentionsBroadIntegration = BROAD_INTEGRATION_TERMS.some((term) =>
    normalized.includes(term),
  );
  if (!mentionsBroadIntegration) {
    return false;
  }
  return !hasSpecificTaskFocus(state.anchors);
}
