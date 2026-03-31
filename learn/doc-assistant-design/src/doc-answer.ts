import { runLearningAgentCommand } from "../../agent-design/src/index.js";
import { detectAnswerLanguage, type AnswerLanguage } from "./answer-language.js";
import type {
  DocAnswerReviewStatus,
  DocAnswerSource,
  DocAssistantMode,
  DocCitation,
  DocFollowUpSource,
  DocSearchHit,
  DocsTerminalResult,
  OpenAICompatibleConfig,
} from "./protocol/index.js";
import { answerWithOpenAICompatible } from "./openai-compatible.js";
import { resolveDocAssistantAgentScratchDataDir } from "./session-store.js";

export type DocAnswerResult = {
  mode: DocAssistantMode;
  answer: string;
  summary: string;
  citations: DocCitation[];
  selectedProvider?: string;
  selectedModel?: string;
  answerSource?: DocAnswerSource;
  memoryEntryId?: string;
  reviewStatus?: DocAnswerReviewStatus;
  followUpSource?: DocFollowUpSource;
  continuedFromRunId?: string;
  rewrittenQuestion?: string;
  attempts?: Array<{
    provider: string;
    model: string;
    ok: boolean;
    reason?: string;
  }>;
};

type DocPlatform = "android" | "ios" | "web" | "flutter";
type DocChannelKind = "direct" | "group" | "community";
type QuestionIntent = "concept" | "procedural";
type AnswerRole =
  | "setup"
  | "connect"
  | "navigation"
  | "platform"
  | "start_chat"
  | "send_first_message"
  | "definition"
  | "server_irrelevant"
  | "reference";

type AnalyzedHit = DocSearchHit & {
  platform?: DocPlatform;
  channelKind?: DocChannelKind;
  role: AnswerRole;
};

const CONCEPT_MARKER_TERMS = [
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

function citationLabel(citation: DocCitation): string {
  const heading = citation.heading ? `#${citation.heading}` : "";
  return `${citation.path}${heading}:${citation.startLine}-${citation.endLine}`;
}

function renderSourcesAppendix(citations: DocCitation[]): string {
  if (citations.length === 0) {
    return "Sources:\n- none";
  }
  return [
    "Sources:",
    ...citations.map((citation) => `- ${citationLabel(citation)}`),
  ].join("\n");
}

function sectionLabel(
  language: AnswerLanguage,
  key: "need" | "steps" | "apis" | "notes" | "definition" | "keyPoints",
): string {
  if (language === "en") {
    if (key === "need") {
      return "What you need";
    }
    if (key === "steps") {
      return "Steps";
    }
    if (key === "apis") {
      return "Key APIs or docs";
    }
    if (key === "notes") {
      return "Notes";
    }
    if (key === "definition") {
      return "Definition";
    }
    return "Key points";
  }
  if (key === "need") {
    return "准备工作";
  }
  if (key === "steps") {
    return "步骤";
  }
  if (key === "apis") {
    return "关键 API / 文档";
  }
  if (key === "notes") {
    return "注意事项";
  }
  if (key === "definition") {
    return "定义";
  }
  return "关键点";
}

function inlineCitation(hit: DocCitation): string {
  return `[${hit.path}:${hit.startLine}-${hit.endLine}]`;
}

function normalizeAnswerText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bjavascript\b/g, "web")
    .replace(/\bjs\b/g, "web")
    .replace(/\bdms?\b/g, "direct channel")
    .replace(/\bdirect messages?\b/g, "direct channel")
    .replace(/\bprivate messages?\b/g, "direct channel")
    .replace(/\bdirect chats?\b/g, "direct channel")
    .replace(/\bprivate chats?\b/g, "direct channel")
    .replace(/\bsingle chats?\b/g, "direct channel")
    .replace(/\b1[\s\-_/]*to[\s\-_/]*1\b/g, "one to one")
    .replace(/\b1[\s\-_/]*on[\s\-_/]*1\b/g, "one to one")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ")
    .trim();
}

function detectPlatform(value: string): DocPlatform | undefined {
  const normalized = normalizeAnswerText(value);
  if (normalized.includes("android")) {
    return "android";
  }
  if (normalized.includes("ios")) {
    return "ios";
  }
  if (normalized.includes("web")) {
    return "web";
  }
  if (normalized.includes("flutter")) {
    return "flutter";
  }
  return undefined;
}

function detectChannelKind(value: string): DocChannelKind | undefined {
  const normalized = normalizeAnswerText(value);
  if (
    normalized.includes("community channel") ||
    normalized.includes("subchannel") ||
    normalized.includes("private subchannel") ||
    normalized.includes("open channel")
  ) {
    return "community";
  }
  if (
    normalized.includes("direct system channels") ||
    normalized.includes("direct channel") ||
    normalized.includes("one to one") ||
    normalized.includes("directchannel")
  ) {
    return "direct";
  }
  if (
    normalized.includes("group channel") ||
    normalized.includes("create a group") ||
    normalized.includes("creategroupparams") ||
    normalized.includes("groupchannel")
  ) {
    return "group";
  }
  return undefined;
}

function formatChannelKind(kind: DocChannelKind): string {
  if (kind === "direct") {
    return "direct channel";
  }
  if (kind === "group") {
    return "group channel";
  }
  return "community channel / subchannel";
}

function detectQuestionChannelKind(question: string): DocChannelKind | undefined {
  return detectChannelKind(question);
}

function isExplicitServerApiQuestion(question: string): boolean {
  const normalized = normalizeAnswerText(question);
  return (
    normalized.includes("server api") ||
    normalized.includes("platform chat api") ||
    normalized.includes("rest api") ||
    normalized.includes("http api") ||
    normalized.includes("api endpoint")
  );
}

function isChannelFocusedQuestion(question: string): boolean {
  const normalized = normalizeAnswerText(question);
  return (
    normalized.includes("channel") ||
    normalized.includes("conversation") ||
    normalized.includes("direct channel") ||
    normalized.includes("group channel") ||
    normalized.includes("community channel")
  );
}

function formatPlatform(platform: DocPlatform): string {
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

function extractCodeTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const match of text.matchAll(/`([^`\n]{2,80})`/g)) {
    const value = match[1]?.trim();
    if (value) {
      terms.add(value);
    }
    if (terms.size >= 6) {
      break;
    }
  }
  const plainPatterns = [
    /\bNCEngine\.initialize\b/g,
    /\bNCEngine\.connect\b/g,
    /\bDirectChannel\b/g,
    /\bSendTextMessageParams\b/g,
    /\bdirectedUserIds\b/g,
    /\bintent-filter\b/g,
    /\bPushMessageReceiver\b/g,
    /\bchannel\.sendMessage\b/g,
  ];
  for (const pattern of plainPatterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0]?.trim();
      if (value) {
        terms.add(value);
      }
      if (terms.size >= 8) {
        return Array.from(terms);
      }
    }
  }
  return Array.from(terms);
}

function dedupeCitations(hits: DocSearchHit[]): DocCitation[] {
  const seen = new Set<string>();
  const citations: DocCitation[] = [];
  for (const hit of hits) {
    const key = `${hit.path}:${hit.startLine}:${hit.endLine}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    citations.push({
      path: hit.path,
      heading: hit.heading,
      startLine: hit.startLine,
      endLine: hit.endLine,
      snippet: hit.snippet,
    });
  }
  return citations;
}

function classifyHitRole(hit: DocSearchHit): AnswerRole {
  const normalized = normalizeAnswerText([hit.path, hit.heading ?? "", hit.text].join("\n"));
  const normalizedBody = normalizeAnswerText(hit.text);
  const normalizedHeadingPath = normalizeAnswerText([hit.path, hit.heading ?? ""].join("\n"));

  if (
    normalized.includes("platform chat api") ||
    normalized.includes("server api") ||
    normalized.includes("query history") ||
    normalized.includes("cloud message history") ||
    normalized.includes("sync to sender") ||
    normalized.includes("isechotosender") ||
    normalized.includes("issyncsender")
  ) {
    return "server_irrelevant";
  }

  if (
    normalizedHeadingPath.includes("push notification click") ||
    normalizedHeadingPath.includes("notification click") ||
    normalizedHeadingPath.includes("channel page") ||
    normalizedHeadingPath.includes("channel list page") ||
    normalizedBody.includes("intent filter") ||
    normalizedBody.includes("androidmanifest")
  ) {
    return "navigation";
  }

  if (
    normalizedHeadingPath.includes("about ") ||
    normalizedHeadingPath.startsWith("what is ") ||
    normalizedHeadingPath.startsWith("what are ") ||
    normalizedHeadingPath.includes("glossary") ||
    normalizedHeadingPath.includes("offline messages") ||
    normalizedHeadingPath.includes("missed messages") ||
    normalizedBody.includes(" is a ") ||
    normalizedBody.includes(" are ") ||
    normalizedBody.includes(" refers to ")
  ) {
    return "definition";
  }

  if (
    normalizedHeadingPath.includes("send your first message") ||
    normalizedHeadingPath.includes("send a message") ||
    normalizedHeadingPath.includes("message send") ||
    normalizedHeadingPath.includes("targeted message") ||
    normalized.includes("sendtextmessageparams") ||
    normalized.includes("channel sendmessage") ||
    normalized.includes("directeduserids")
  ) {
    return "send_first_message";
  }

  if (
    normalizedHeadingPath.includes("import the sdk") ||
    normalizedHeadingPath.includes("initialize the sdk") ||
    normalizedHeadingPath.includes("quickstart") ||
    normalizedHeadingPath.includes("get started") ||
    normalizedHeadingPath.includes("getting started") ||
    normalizedHeadingPath.includes("requirements") ||
    normalizedHeadingPath.includes("prerequisites") ||
    normalizedHeadingPath.endsWith(" import") ||
    normalizedHeadingPath.endsWith(" init")
  ) {
    return "setup";
  }

  if (
    normalizedHeadingPath.includes("connect") ||
    normalizedHeadingPath.includes("connection") ||
    normalizedHeadingPath.includes("token") ||
    normalizedHeadingPath.includes("/connection/connect")
  ) {
    return "connect";
  }

  if (normalizedHeadingPath.includes("direct channel") || normalizedBody.includes("direct channel")) {
    return "start_chat";
  }

  if (normalizedHeadingPath.includes("channel overview") || normalizedHeadingPath.includes("overview")) {
    return "platform";
  }

  return "reference";
}

function detectQuestionIntent(question: string): QuestionIntent {
  const normalized = normalizeAnswerText(question);
  const conceptMarkers = [...CONCEPT_MARKER_TERMS, "meaning of"];
  const proceduralMarkers = [
    "how to",
    "how do",
    "how can",
    "start",
    "send",
    "configure",
    "connect",
    "initialize",
    "install",
    "create",
    "发起",
    "配置",
    "连接",
    "初始化",
    "如何",
    "怎么",
  ];

  if (proceduralMarkers.some((marker) => normalized.includes(marker))) {
    return "procedural";
  }
  if (conceptMarkers.some((marker) => normalized.includes(marker))) {
    return "concept";
  }
  if (normalized.split(" ").length <= 5 && !normalized.includes("sdk")) {
    return "concept";
  }
  return "procedural";
}

function extractConceptFocusTerms(question: string): string[] {
  const normalized = normalizeAnswerText(question);
  let stripped = normalized;
  for (const marker of CONCEPT_MARKER_TERMS) {
    stripped = stripped.replace(marker, " ");
  }
  stripped = stripped.replace(/\bis\b/g, " ").replace(/\bare\b/g, " ").trim();
  const tokens = tokenizeLike(stripped);
  return tokens.filter((token) => token.length >= 4 || /[\u4e00-\u9fff]{2,}/.test(token));
}

function tokenizeLike(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function looksLikeDefinitionEvidence(question: string, hit: AnalyzedHit): boolean {
  const focusTerms = extractConceptFocusTerms(question);
  if (focusTerms.length === 0) {
    return hit.role === "definition";
  }
  const normalizedHeadingPath = normalizeAnswerText([hit.path, hit.heading ?? ""].join("\n"));
  const normalizedSnippet = normalizeAnswerText(hit.snippet);
  const normalizedBody = normalizeAnswerText(hit.text.slice(0, 280));
  const hasFocusInHeadingPath = focusTerms.some((term) => normalizedHeadingPath.includes(term));
  const hasFocusInVisibleText = focusTerms.some(
    (term) => normalizedSnippet.includes(term) || normalizedBody.includes(term),
  );
  const hasDefinitionSignal =
    hit.role === "definition" ||
    normalizedHeadingPath.includes("glossary") ||
    normalizedHeadingPath.includes("about ") ||
    normalizedHeadingPath.includes("what is ") ||
    normalizedSnippet.includes(" is a ") ||
    normalizedSnippet.includes(" refers to ") ||
    normalizedBody.includes(" is a ") ||
    normalizedBody.includes(" refers to ");

  if (!hasFocusInVisibleText) {
    return false;
  }
  if (focusTerms.length === 1) {
    return hasDefinitionSignal && (hasFocusInHeadingPath || normalizedSnippet.includes(focusTerms[0]));
  }
  return hasDefinitionSignal && hasFocusInHeadingPath;
}

function analyzeHits(question: string, hits: DocSearchHit[]): {
  explicitPlatform?: DocPlatform;
  explicitChannelKind?: DocChannelKind;
  selectedPlatform?: DocPlatform;
  selectedChannelKind?: DocChannelKind;
  shouldClarifyChannelKind: boolean;
  shouldClarifyPlatform: boolean;
  foundPlatforms: DocPlatform[];
  foundChannelKinds: DocChannelKind[];
  analyzedHits: AnalyzedHit[];
  relevantHits: AnalyzedHit[];
  usedHits: AnalyzedHit[];
} {
  const explicitPlatform = detectPlatform(question);
  const explicitChannelKind = detectQuestionChannelKind(question);
  const analyzedHits = hits.map((hit) => ({
    ...hit,
    platform: detectPlatform(hit.path) ?? detectPlatform(hit.heading ?? "") ?? detectPlatform(hit.text),
    channelKind:
      detectChannelKind(hit.path) ?? detectChannelKind(hit.heading ?? "") ?? detectChannelKind(hit.text),
    role: classifyHitRole(hit),
  }));
  const relevantHits = analyzedHits.filter((hit) => hit.role !== "server_irrelevant");
  const channelScopedPool = analyzedHits;
  const channelHits = channelScopedPool.filter((hit) => hit.channelKind !== undefined);
  const foundChannelKinds = Array.from(
    new Set(
      channelHits
        .map((hit) => hit.channelKind)
        .filter((kind): kind is DocChannelKind => kind !== undefined),
    ),
  );
  const normalizedQuestion = normalizeAnswerText(question);
  const mentionsChannelCreationTopic =
    normalizedQuestion.includes("create") &&
    (normalizedQuestion.includes("channel") || normalizedQuestion.includes("conversation"));
  const shouldClarifyChannelKind =
    !explicitChannelKind &&
    mentionsChannelCreationTopic &&
    foundChannelKinds.length > 1;

  let selectedChannelKind = explicitChannelKind;
  if (!selectedChannelKind && isChannelFocusedQuestion(question) && foundChannelKinds.length > 0) {
    selectedChannelKind = channelHits
      .slice()
      .sort((left, right) => right.score - left.score)[0]?.channelKind;
  }

  const channelScopedHits =
    selectedChannelKind && !shouldClarifyChannelKind
      ? (() => {
          const preferredHits = relevantHits.filter(
            (hit) => hit.channelKind === selectedChannelKind || !hit.channelKind,
          );
          if (preferredHits.length > 0) {
            return preferredHits;
          }
          return analyzedHits.filter(
            (hit) => hit.channelKind === selectedChannelKind || !hit.channelKind,
          );
        })()
      : relevantHits.length > 0
        ? relevantHits
        : analyzedHits;

  const platformHits = (channelScopedHits.length > 0 ? channelScopedHits : analyzedHits).filter(
    (hit) => hit.platform !== undefined,
  );
  const foundPlatforms = Array.from(
    new Set(
      platformHits
        .map((hit) => hit.platform)
        .filter((platform): platform is DocPlatform => platform !== undefined),
    ),
  );
  const isClientSdkQuestion = analyzedHits.some((hit) => /\/(chat|call)(sdk|ui)-/.test(hit.path));
  const mentionsPlatformDependentTopic =
    normalizedQuestion.includes("sdk") ||
    normalizedQuestion.includes("direct channel") ||
    normalizedQuestion.includes("chat") ||
    normalizedQuestion.includes("call") ||
    normalizedQuestion.includes("message");
  const shouldClarifyPlatform =
    !explicitPlatform &&
    isClientSdkQuestion &&
    mentionsPlatformDependentTopic &&
    foundPlatforms.length > 1;

  let selectedPlatform = explicitPlatform;
  if (!selectedPlatform && foundPlatforms.length > 0) {
    selectedPlatform = platformHits
      .slice()
      .sort((left, right) => right.score - left.score)[0]?.platform;
  }

  const usedHits = (selectedPlatform
    ? channelScopedHits.filter((hit) => hit.platform === selectedPlatform || !hit.platform)
    : channelScopedHits
  ).sort((left, right) => right.score - left.score);

  return {
    explicitPlatform,
    explicitChannelKind,
    selectedPlatform,
    selectedChannelKind,
    shouldClarifyChannelKind,
    shouldClarifyPlatform,
    foundPlatforms,
    foundChannelKinds,
    analyzedHits,
    relevantHits,
    usedHits,
  };
}

function pickBestHit(hits: AnalyzedHit[], roles: AnswerRole[]): AnalyzedHit | undefined {
  return hits
    .filter((hit) => roles.includes(hit.role))
    .sort((left, right) => right.score - left.score)[0];
}

function pickBestHitByPredicate(
  hits: AnalyzedHit[],
  predicate: (hit: AnalyzedHit, normalizedHeadingPath: string, normalizedBody: string) => boolean,
): AnalyzedHit | undefined {
  return hits
    .filter((hit) =>
      predicate(
        hit,
        normalizeAnswerText([hit.path, hit.heading ?? ""].join("\n")),
        normalizeAnswerText(hit.text),
      ),
    )
    .sort((left, right) => right.score - left.score)[0];
}

function buildClarificationAnswer(
  question: string,
  analysis: ReturnType<typeof analyzeHits>,
  language: AnswerLanguage,
): DocAnswerResult {
  const platformHits = analysis.relevantHits.filter((hit) => hit.platform !== undefined);
  const bestByPlatform = new Map<DocPlatform, AnalyzedHit>();
  for (const hit of platformHits) {
    if (hit.platform && !bestByPlatform.has(hit.platform)) {
      bestByPlatform.set(hit.platform, hit);
    }
  }
  const citations = dedupeCitations(Array.from(bestByPlatform.values()));
  const platformText = analysis.foundPlatforms.map((platform) => formatPlatform(platform)).join(" / ");
  const examples = Array.from(bestByPlatform.entries()).map(
    ([platform, hit]) => `- ${formatPlatform(platform)}: ${hit.heading ?? hit.path} ${inlineCitation(hit)}`,
  );

  return {
    mode: "extractive",
    answer: [
      language === "en"
        ? `This question depends on the target platform. Choose ${platformText}, and the answer can be narrowed to the matching implementation steps.`
        : `这是一个和平台相关的问题。请告诉我你要看 ${platformText} 中的哪一个平台，我会按对应平台整理开始聊天的步骤。`,
      examples.length > 0
        ? [(language === "en" ? "Relevant doc entry points:" : "相关文档入口："), ...examples].join("\n")
        : "",
      renderSourcesAppendix(citations),
    ]
      .filter(Boolean)
      .join("\n\n"),
    summary: "platform clarification required",
    citations,
    answerSource: "generated",
    reviewStatus: "not_applicable",
  };
}

function buildChannelClarificationAnswer(
  analysis: ReturnType<typeof analyzeHits>,
  language: AnswerLanguage,
): DocAnswerResult {
  const channelHits = analysis.analyzedHits.filter((hit) => hit.channelKind !== undefined);
  const bestByChannelKind = new Map<DocChannelKind, AnalyzedHit>();
  for (const hit of channelHits) {
    if (hit.channelKind && !bestByChannelKind.has(hit.channelKind)) {
      bestByChannelKind.set(hit.channelKind, hit);
    }
  }
  const citations = dedupeCitations(Array.from(bestByChannelKind.values()));
  const kindText = analysis.foundChannelKinds.map((kind) => formatChannelKind(kind)).join(" / ");
  const examples = Array.from(bestByChannelKind.entries()).map(
    ([kind, hit]) => `- ${formatChannelKind(kind)}: ${hit.heading ?? hit.path} ${inlineCitation(hit)}`,
  );

  return {
    mode: "extractive",
    answer: [
      language === "en"
        ? `In these docs, "channel" can mean ${kindText}. Specify which one you need, and the answer can be narrowed to the matching implementation steps.`
        : `这个问题里的 channel 可能指 ${kindText}。请告诉我你要看哪一类，我再按对应文档整理开发步骤。`,
      examples.length > 0
        ? [(language === "en" ? "Relevant doc entry points:" : "相关文档入口："), ...examples].join("\n")
        : "",
      renderSourcesAppendix(citations),
    ]
      .filter(Boolean)
      .join("\n\n"),
    summary: "channel clarification required",
    citations,
    answerSource: "generated",
    reviewStatus: "not_applicable",
  };
}

function buildNoHitAnswer(question: string, language: AnswerLanguage): DocAnswerResult {
  return {
    mode: "extractive",
    answer: [
      language === "en"
        ? `I couldn't find local Markdown documentation that directly answers "${question}".`
        : `我没有在本地 Markdown 文档库里找到和“${question}”直接相关的内容。`,
      language === "en"
        ? "Try a more specific query, or confirm the target docs are present under docs/."
        : "你可以换更具体的关键词，或者确认目标文档已经放进 docs/ 目录。",
      renderSourcesAppendix([]),
    ].join("\n\n"),
    summary: "no relevant documentation found",
    citations: [],
    answerSource: "generated",
    reviewStatus: "not_applicable",
  };
}

function buildGuideIntro(params: {
  language: AnswerLanguage;
  platform?: DocPlatform;
  channelKind?: DocChannelKind;
  overviewHit?: AnalyzedHit;
  setupHit?: AnalyzedHit;
  connectHit?: AnalyzedHit;
  channelHit?: AnalyzedHit;
  sendHit?: AnalyzedHit;
}): string {
  const citation = params.overviewHit ? ` ${inlineCitation(params.overviewHit)}` : "";
  const platformText = params.platform ? formatPlatform(params.platform) : undefined;
  if (params.language === "en") {
    const onPlatform = platformText ? ` on ${platformText}` : "";
    if (params.channelKind === "group") {
      return `Use the documented flow below to create a group channel${onPlatform}.${citation}`;
    }
    if (params.channelKind === "community") {
      return `Use the documented flow below to create a community channel or subchannel${onPlatform}.${citation}`;
    }
    if (params.channelHit || params.sendHit) {
      return `Use the documented flow below to start a direct chat${onPlatform}.${citation}`;
    }
    if (params.setupHit || params.connectHit) {
      return `Complete SDK setup and connection first${onPlatform}, then continue with the chat flow.${citation}`;
    }
    return `Use the documented flow below.${citation}`;
  }
  if (params.platform && (params.channelHit || params.sendHit)) {
    return `下面是 ${formatPlatform(params.platform)} 的对应文档步骤，用来开始当前聊天流程。${citation}`;
  }
  return `下面是当前问题对应的文档步骤。${citation}`;
}

function buildNeedLine(hit: AnalyzedHit, language: AnswerLanguage): string {
  const normalized = normalizeAnswerText([hit.path, hit.heading ?? "", hit.text].join("\n"));
  if (hit.role === "navigation") {
    return language === "en"
      ? `- Add an \`intent-filter\` in \`AndroidManifest.xml\` so notification taps can open the target conversation page.${inlineCitation(hit)}`
      : `- 在 \`AndroidManifest.xml\` 里配置接收通知点击的 \`intent-filter\`，让应用可以打开对应 conversation 页面。${inlineCitation(hit)}`;
  }
  if (normalized.includes("import")) {
    return language === "en"
      ? `- Add the Chat SDK dependency to the project.${inlineCitation(hit)}`
      : `- 先把 Chat SDK 依赖接入项目。${inlineCitation(hit)}`;
  }
  if (normalized.includes("initialize")) {
    const term = extractCodeTerms(hit.text).find((value) => value.includes("initialize")) ?? "NCEngine.initialize()";
    return language === "en"
      ? `- Call \`${term}\` during app startup.${inlineCitation(hit)}`
      : `- 在应用启动阶段调用 \`${term}\` 完成初始化。${inlineCitation(hit)}`;
  }
  if (normalized.includes("connect") || normalized.includes("token")) {
    return language === "en"
      ? `- Prepare an access token for the current user and make sure the client is connected to the Nexconn server.${inlineCitation(hit)}`
      : `- 准备用户 access token，并确保客户端已经连上 Nexconn 服务器。${inlineCitation(hit)}`;
  }
  if (normalized.includes("direct channel")) {
    return language === "en"
      ? `- A direct channel uses the target user ID as its channel ID, so identify the target user first.${inlineCitation(hit)}`
      : `- Direct channel 的 channelId 就是对方用户 ID，需要先明确聊天目标用户。${inlineCitation(hit)}`;
  }
  return language === "en"
    ? `- Review ${hit.heading ?? hit.path} for the prerequisite details.${inlineCitation(hit)}`
    : `- 先阅读 ${hit.heading ?? hit.path}，确认接入前置条件。${inlineCitation(hit)}`;
}

function buildStepLine(hit: AnalyzedHit, language: AnswerLanguage): string {
  const normalized = normalizeAnswerText([hit.path, hit.heading ?? "", hit.text].join("\n"));
  const codeTerms = extractCodeTerms([hit.heading ?? "", hit.text].join("\n"));
  const directChannel =
    codeTerms.find((value) => value.includes("DirectChannel"))?.replace(/\(.*/, "") ?? "DirectChannel";
  const initialize = codeTerms.find((value) => value.includes("initialize")) ?? "NCEngine.initialize()";
  const sendParams =
    codeTerms.find((value) => value.includes("SendTextMessageParams"))?.replace(/\(.*/, "") ??
    "SendTextMessageParams";
  const sendMethod =
    codeTerms.find((value) => value.includes("sendMessage")) ?? "channel.sendMessage(...)";
  const initializeCall =
    codeTerms.find((value) => value.includes("NCEngine.initialize")) ?? initialize;
  const connectCall = codeTerms.find((value) => value.includes("connect")) ?? "NCEngine.connect(...)";
  const targetedField = codeTerms.find((value) => value.includes("directedUserIds")) ?? "directedUserIds";

  if (hit.role === "setup") {
    if (normalized.includes("import")) {
      return language === "en"
        ? `Add the Chat SDK dependency to the project first.${inlineCitation(hit)}`
        : `先把 Chat SDK 依赖加入工程，确保项目已经完成基础接入。${inlineCitation(hit)}`;
    }
    if (normalized.includes("initialize")) {
      return language === "en"
        ? `Call \`${initializeCall}\` to initialize the SDK.${inlineCitation(hit)}`
        : `调用 \`${initializeCall}\` 完成 SDK 初始化。${inlineCitation(hit)}`;
    }
    return language === "en"
      ? `Complete the quickstart setup steps first.${inlineCitation(hit)}`
      : `先完成 quickstart 里的基础接入步骤。${inlineCitation(hit)}`;
  }

  if (hit.role === "connect") {
    return language === "en"
      ? `Get an access token for the current user, then call \`${connectCall}\` to connect to the Nexconn server before entering the chat flow.${inlineCitation(hit)}`
      : `为当前用户获取 access token，然后调用 \`${connectCall}\` 连接到 Nexconn 服务器；连接成功后再进入聊天流程。${inlineCitation(hit)}`;
  }

  if (hit.role === "navigation") {
    return language === "en"
      ? `Configure an \`intent-filter\` for the conversation page in \`AndroidManifest.xml\` so notification taps can open the target chat.${inlineCitation(hit)}`
      : `在 \`AndroidManifest.xml\` 里为单聊页面配置 \`intent-filter\`，让通知点击后可以打开对应 conversation 页面。${inlineCitation(hit)}`;
  }

  if (hit.role === "start_chat" || hit.role === "platform") {
    return language === "en"
      ? `Create \`${directChannel}("<target-user-id>")\` as the one-to-one conversation object for the target user.${inlineCitation(hit)}`
      : `创建 \`${directChannel}("<target-user-id>")\` 作为与目标用户的一对一会话对象。${inlineCitation(hit)}`;
  }

  if (hit.role === "send_first_message") {
    if (normalized.includes("directeduserids")) {
      return language === "en"
        ? `Create \`${sendParams}\`, set \`${targetedField}\` to the target members, then call \`${sendMethod}\` to send the targeted message.${inlineCitation(hit)}`
        : `构造 \`${sendParams}\`，设置 \`${targetedField}\` 指定目标成员，然后调用 \`${sendMethod}\` 发送定向消息。${inlineCitation(hit)}`;
    }
    if (normalized.includes("directchannel")) {
      return language === "en"
        ? `Create \`${directChannel}("<target-user-id>")\`, then build \`${sendParams}\` and call \`${sendMethod}\` to send the first message.${inlineCitation(hit)}`
        : `创建 \`${directChannel}("<target-user-id>")\`，再构造 \`${sendParams}\` 并调用 \`${sendMethod}\` 发送第一条消息。${inlineCitation(hit)}`;
    }
    return language === "en"
      ? `Build \`${sendParams}\`, then call \`${sendMethod}\` to send the first message.${inlineCitation(hit)}`
      : `构造 \`${sendParams}\`，然后调用 \`${sendMethod}\` 发送第一条消息。${inlineCitation(hit)}`;
  }

  return language === "en"
    ? `Complete this step as documented in ${hit.heading ?? hit.path}.${inlineCitation(hit)}`
    : `按 ${hit.heading ?? hit.path} 中的说明完成这一步。${inlineCitation(hit)}`;
}

function summarizeConceptLead(question: string, hit: AnalyzedHit, language: AnswerLanguage): string {
  const sentence = hit.snippet.replace(/\s+/g, " ").trim();
  const inline = inlineCitation(hit);
  if (sentence) {
    return language === "en"
      ? `For "${question}", the docs define it as: ${sentence}${inline}`
      : `关于“${question}”，文档里的核心定义是：${sentence}${inline}`;
  }
  return language === "en"
    ? `Start with ${hit.heading ?? hit.path} to understand "${question}".${inline}`
    : `关于“${question}”，可以先从 ${hit.heading ?? hit.path} 理解这个概念。${inline}`;
}

function buildConceptKeyPoint(hit: AnalyzedHit, language: AnswerLanguage): string {
  const normalized = normalizeAnswerText([hit.heading ?? "", hit.text].join("\n"));
  if (normalized.includes("retain") || normalized.includes("retention") || normalized.includes("7 days")) {
    return language === "en"
      ? `- The server retains undelivered messages while the user is offline. Use the documented retention window to understand how long those messages can still be delivered.${inlineCitation(hit)}`
      : `- 服务端会在离线期间保留未投递消息；如果文档提到了保留时长或窗口期，可以按该配置理解消息补投行为。${inlineCitation(hit)}`;
  }
  if (normalized.includes("reconnect") || normalized.includes("come online") || normalized.includes("online")) {
    return language === "en"
      ? `- When the user reconnects within that retention window, Nexconn pushes the queued offline messages back to the client.${inlineCitation(hit)}`
      : `- 当用户重新上线并在保留窗口内 reconnect 时，Nexconn 会把这段离线期间积压的消息补发给客户端。${inlineCitation(hit)}`;
  }
  if (normalized.includes("console") || normalized.includes("setting") || normalized.includes("retention period")) {
    return language === "en"
      ? `- This behavior is usually paired with console-side retention settings, such as the offline message cloud retention period.${inlineCitation(hit)}`
      : `- 这个能力通常还伴随控制台侧的保留策略配置，例如离线消息云端保留时长。${inlineCitation(hit)}`;
  }
  return `- ${hit.snippet}${inlineCitation(hit)}`;
}

function buildConceptAnswer(
  question: string,
  hits: DocSearchHit[],
  language: AnswerLanguage,
): DocAnswerResult {
  const analysis = analyzeHits(question, hits);
  const effectiveHits = analysis.usedHits.length > 0 ? analysis.usedHits : analysis.relevantHits;
  if (effectiveHits.length === 0) {
    return buildNoHitAnswer(question, language);
  }

  const definitionHit =
    pickBestHit(effectiveHits, ["definition"]) ??
    pickBestHitByPredicate(
      effectiveHits,
      (_hit, normalizedHeadingPath) =>
        normalizedHeadingPath.includes("about ") ||
        normalizedHeadingPath.includes("glossary") ||
        normalizedHeadingPath.includes("offline messages") ||
        normalizedHeadingPath.includes("missed messages"),
    ) ??
    effectiveHits[0];

  if (!looksLikeDefinitionEvidence(question, definitionHit)) {
    return {
      mode: "extractive",
      answer: [
        language === "en"
          ? `I couldn't find reliable local documentation that directly defines "${question}".`
          : `我没有在当前本地文档里找到能够直接定义“${question}”的可靠内容。`,
        language === "en"
          ? "The current hits mention the term incidentally inside feature pages instead of defining the concept itself."
          : "现有命中结果更像是功能页里顺带提到相关术语，而不是解释这个概念本身。",
        language === "en"
          ? "If needed, narrow the question to a specific SDK, feature, or page context."
          : "如果你想了解某个具体 SDK、功能或页面里的 Nexconn 含义，可以继续补充平台或场景。",
        renderSourcesAppendix([]),
      ].join("\n\n"),
      summary: "no relevant documentation found",
      citations: [],
      answerSource: "generated",
      reviewStatus: "not_applicable",
    };
  }

  const supportingHits = effectiveHits
    .filter((hit) => hit !== definitionHit)
    .filter((hit) => {
      const normalized = normalizeAnswerText([hit.heading ?? "", hit.text].join("\n"));
      return (
        normalized.includes("retain") ||
        normalized.includes("retention") ||
        normalized.includes("reconnect") ||
        normalized.includes("online") ||
        normalized.includes("console") ||
        normalized.includes("setting") ||
        normalized.includes("duration")
      );
    })
    .slice(0, 3);

  const citations = dedupeCitations([definitionHit, ...supportingHits]);
  const noteLines: string[] = [];
  if (supportingHits.length === 0 && effectiveHits.length > 1) {
    noteLines.push(
      language === "en"
        ? "- For platform-specific retention settings or client behavior, narrow the question to a specific SDK."
        : "- 如果你接下来想看离线消息的保留时长、控制台设置或不同平台的表现，可以继续追问具体 SDK。",
    );
  }

  return {
    mode: "extractive",
    answer: [
      summarizeConceptLead(question, definitionHit, language),
      [sectionLabel(language, "definition"), `- ${definitionHit.snippet}${inlineCitation(definitionHit)}`].join(
        "\n",
      ),
      supportingHits.length > 0
        ? [sectionLabel(language, "keyPoints"), ...supportingHits.map((hit) => buildConceptKeyPoint(hit, language))].join(
            "\n",
          )
        : "",
      noteLines.length > 0 ? [sectionLabel(language, "notes"), ...noteLines].join("\n") : "",
      renderSourcesAppendix(citations),
    ]
      .filter(Boolean)
      .join("\n\n"),
    summary: `concept answer from ${citations.length} documentation chunks`,
    citations,
    answerSource: "generated",
    reviewStatus: "not_applicable",
  };
}

function buildGuideAnswer(
  question: string,
  hits: DocSearchHit[],
  language: AnswerLanguage,
): DocAnswerResult {
  const analysis = analyzeHits(question, hits);
  if (analysis.shouldClarifyChannelKind) {
    return buildChannelClarificationAnswer(analysis, language);
  }
  if (analysis.shouldClarifyPlatform) {
    return buildClarificationAnswer(question, analysis, language);
  }

  if (analysis.relevantHits.length === 0 && !isExplicitServerApiQuestion(question)) {
    return buildNoHitAnswer(question, language);
  }

  const effectiveHits = analysis.usedHits.length > 0 ? analysis.usedHits : analysis.relevantHits;
  if (effectiveHits.length === 0) {
    return buildNoHitAnswer(question, language);
  }

  const importHit = pickBestHitByPredicate(
    effectiveHits,
    (_hit, normalizedHeadingPath) => normalizedHeadingPath.includes("import"),
  );
  const initializeHit = pickBestHitByPredicate(
    effectiveHits,
    (_hit, normalizedHeadingPath, normalizedBody) =>
      normalizedHeadingPath.includes("initialize") ||
      normalizedBody.includes("ncengine initialize"),
  );
  const setupHit = importHit ?? initializeHit ?? pickBestHit(effectiveHits, ["setup"]);
  const connectHit =
    pickBestHitByPredicate(
      effectiveHits,
      (_hit, normalizedHeadingPath, normalizedBody) =>
        normalizedHeadingPath.includes("connect") ||
        normalizedHeadingPath.includes("connection") ||
        normalizedBody.includes("ncengine connect") ||
        normalizedBody.includes("connect the user"),
    ) ?? pickBestHit(effectiveHits, ["connect"]);
  const navigationHit = pickBestHit(effectiveHits, ["navigation"]);
  const channelHit = pickBestHit(effectiveHits, ["start_chat", "platform"]);
  const sendHit = pickBestHit(effectiveHits, ["send_first_message"]);
  const overviewHit = pickBestHit(effectiveHits, ["platform", "start_chat", "setup"]);

  const needHits = [importHit, initializeHit, connectHit, navigationHit, channelHit].filter(
    (hit): hit is AnalyzedHit => Boolean(hit),
  );
  const stepHits = [importHit, initializeHit, connectHit, navigationHit, channelHit, sendHit].filter(
    (hit, index, all): hit is AnalyzedHit => Boolean(hit) && all.indexOf(hit) === index,
  );
  const citedHits = stepHits.length > 0 ? stepHits : effectiveHits.slice(0, 4);
  const citations = dedupeCitations(citedHits);

  const apiTerms = Array.from(
    new Set(
      citedHits
        .flatMap((hit) => extractCodeTerms([hit.heading ?? "", hit.text].join("\n")))
        .filter((term) =>
          term.includes("Channel") ||
          term.includes("Message") ||
          term.includes("NCEngine") ||
          term.includes("sendMessage") ||
          term.includes("initialize") ||
          term.includes("directedUserIds") ||
          term.includes("intent-filter"),
        ),
    ),
  ).slice(0, 6);

  const noteLines: string[] = [];
  if (channelHit) {
    noteLines.push(
      language === "en"
        ? `- A direct channel is a one-to-one conversation whose channel ID is typically the target user ID.${inlineCitation(channelHit)}`
        : `- Direct channel 表示两个用户之间的一对一私聊，会话标识通常就是对方用户 ID。${inlineCitation(channelHit)}`,
    );
  }
  if (!setupHit && !importHit && !initializeHit) {
    noteLines.push(
      language === "en"
        ? "- The retrieved docs do not cover SDK import or initialization."
        : "- 当前命中的文档没有覆盖完整的 SDK 导入或初始化步骤。",
    );
  }
  if (!connectHit) {
    noteLines.push(
      language === "en"
        ? "- The retrieved docs do not cover token acquisition or connection establishment."
        : "- 当前命中的文档没有展开 token 获取或连接建立步骤。",
    );
  }
  if (!sendHit) {
    noteLines.push(
      language === "en"
        ? "- The retrieved docs do not include a concrete send-message example."
        : "- 当前命中的文档没有给出明确的发消息示例。",
    );
  }

  return {
    mode: "extractive",
    answer: [
      buildGuideIntro({
        language,
        platform: analysis.selectedPlatform,
        channelKind: analysis.selectedChannelKind,
        overviewHit,
        setupHit,
        connectHit,
        channelHit,
        sendHit,
      }),
      needHits.length > 0
        ? [sectionLabel(language, "need"), ...needHits.map((hit) => buildNeedLine(hit, language))].join("\n")
        : "",
      stepHits.length > 0
        ? [sectionLabel(language, "steps"), ...stepHits.map((hit, index) => `${index + 1}. ${buildStepLine(hit, language)}`)].join(
            "\n",
          )
        : "",
      apiTerms.length > 0
        ? [sectionLabel(language, "apis"), ...apiTerms.map((term) => `- \`${term}\``)].join("\n")
        : "",
      noteLines.length > 0 ? [sectionLabel(language, "notes"), ...noteLines].join("\n") : "",
      renderSourcesAppendix(citations),
    ]
      .filter(Boolean)
      .join("\n\n"),
    summary: `guided answer from ${citations.length} documentation chunks`,
    citations,
    answerSource: "generated",
    reviewStatus: "not_applicable",
  };
}

function buildGroundedAnswer(question: string, hits: DocSearchHit[]): DocAnswerResult {
  const language = detectAnswerLanguage(question, hits);
  if (hits.length === 0) {
    return buildNoHitAnswer(question, language);
  }

  if (detectQuestionIntent(question) === "concept") {
    return buildConceptAnswer(question, hits, language);
  }

  return buildGuideAnswer(question, hits, language);
}

function buildAgentPrompt(question: string, groundedAnswer: string, hits: DocSearchHit[]): string {
  const language = detectAnswerLanguage(question, hits);
  const grouped = hits.reduce<Map<string, DocSearchHit[]>>((acc, hit) => {
    const platform = detectPlatform(hit.path) ?? detectPlatform(hit.heading ?? "") ?? "general";
    const role = classifyHitRole(hit);
    const key = `${platform}/${role}`;
    const current = acc.get(key) ?? [];
    current.push(hit);
    acc.set(key, current);
    return acc;
  }, new Map());

  const evidence = grouped.size
    ? Array.from(grouped.entries())
        .map(([group, groupHits]) =>
          [
            `Evidence Group: ${group}`,
            ...groupHits.slice(0, 2).map(
              (hit, index) =>
                `Source ${index + 1}\nPath: ${hit.path}\nHeading: ${hit.heading ?? "(none)"}\nLines: ${hit.startLine}-${hit.endLine}\nSnippet: ${hit.snippet}`,
            ),
          ].join("\n\n"),
        )
        .join("\n\n---\n\n")
    : "No relevant documentation was retrieved.";

  return [
    language === "en"
      ? "You are a technical documentation assistant. Answer only from the retrieved evidence."
      : "你是一个技术文档助手。只能根据提供的检索结果回答。",
    language === "en"
      ? "For how-to, integration, and configuration questions, answer as a developer-helpful guide instead of a search report."
      : "如果问题是 how-to / 集成 / 配置类问题，回答目标是给开发者一份自然、可执行的步骤指南，而不是复述检索结果。",
    language === "en"
      ? "For concept questions such as what is / what's / explain, prioritize a definition, key points, and relevant settings instead of forcing a step-by-step guide."
      : "如果问题是 what is / what's / explain / 是什么 这类概念解释问题，请优先给出定义、关键点和相关配置，不要硬套步骤指南。",
    language === "en"
      ? "If the question depends on platform and the evidence spans multiple platforms while the user did not specify one, ask for the platform instead of guessing."
      : "如果问题依赖平台，且证据同时覆盖多个平台而用户没有说明平台，请先要求用户确认平台，不要猜。",
    language === "en"
      ? "If the evidence is insufficient, say so clearly and do not invent details."
      : "如果证据不足，请明确说本地文档不足，不要编造。",
    language === "en"
      ? "Answer in English and place citations at the end of the relevant sentence, for example [path:start-end]."
      : "用中文回答，并把引用放到对应句子末尾，例如 [path:start-end]。",
    language === "en"
      ? "For procedural answers, prefer: What you need, Steps, Key APIs or docs, Notes, Sources."
      : "步骤类回答优先使用：准备工作、步骤、关键 API / 文档、注意事项、Sources。",
    language === "en"
      ? "For concept answers, prefer: Definition, Key points, Notes, Sources."
      : "概念类回答优先使用：定义、关键点、补充说明、Sources。",
    "",
    `Question: ${question}`,
    "",
    "Retrieved documentation:",
    evidence,
    "",
    "Please stream the final answer between the sentinels below.",
    "FINAL_ANSWER_START",
    groundedAnswer,
    "FINAL_ANSWER_END",
  ].join("\n");
}

function sliceBetweenSentinels(text: string): string {
  const startToken = "FINAL_ANSWER_START";
  const endToken = "FINAL_ANSWER_END";
  const start = text.indexOf(startToken);
  if (start === -1) {
    return "";
  }
  const afterStart = text.slice(start + startToken.length);
  const end = afterStart.indexOf(endToken);
  const visible = end === -1 ? afterStart : afterStart.slice(0, end);
  return visible.replace(/^\s+/, "");
}

export async function buildDocAnswer(params: {
  runId: string;
  question: string;
  mode: DocAssistantMode;
  hits: DocSearchHit[];
  dataDir?: string;
  backend?: "embedded" | "cli";
  provider?: string;
  model?: string;
  openAICompatible?: OpenAICompatibleConfig;
  onDelta?: (data: { text: string; delta: string }) => void;
}): Promise<DocAnswerResult> {
  const grounded = buildGroundedAnswer(params.question, params.hits);
  if (params.mode === "extractive") {
    return grounded;
  }
  if (
    params.hits.length === 0 ||
    grounded.summary === "no relevant documentation found" ||
    grounded.summary === "platform clarification required" ||
    grounded.summary === "channel clarification required"
  ) {
    return {
      ...grounded,
      mode: "agent",
    };
  }
  if (
    params.openAICompatible &&
    (!params.provider ||
      params.provider === "openai" ||
      params.provider === "openai-compatible")
  ) {
    const remote = await answerWithOpenAICompatible({
      config: {
        ...params.openAICompatible,
        model: params.model ?? params.openAICompatible.model,
      },
      question: params.question,
      hits: params.hits,
      onDelta: params.onDelta,
    });
    return {
      ...grounded,
      mode: "agent",
      answer: remote.answer,
      summary: `answered with ${remote.selectedProvider}/${remote.selectedModel}`,
      selectedProvider: remote.selectedProvider,
      selectedModel: remote.selectedModel,
    };
  }

  const prompt = buildAgentPrompt(params.question, grounded.answer, params.hits);
  const eagerDelta = grounded.answer.slice(0, Math.min(80, grounded.answer.length));
  if (eagerDelta) {
    params.onDelta?.({
      text: eagerDelta,
      delta: eagerDelta,
    });
  }
  let lastVisible = "";
  const agentRun = runLearningAgentCommand({
    runId: `${params.runId}-agent`,
    message: prompt,
    sessionKey: `scratch/${params.runId}`,
    dataDir: resolveDocAssistantAgentScratchDataDir(params.dataDir),
    backend: params.backend,
    provider: params.provider,
    model: params.model,
    onEvent: (event) => {
      if (event.type !== "delta") {
        return;
      }
      const visible = sliceBetweenSentinels(event.text);
      if (!visible || visible === lastVisible) {
        return;
      }
      const delta = visible.slice(lastVisible.length);
      lastVisible = visible;
      params.onDelta?.({
        text: visible,
        delta,
      });
    },
  });
  const terminal = await agentRun.completion;
  const terminalAnswer = sliceBetweenSentinels(terminal.reply ?? "") || lastVisible || grounded.answer;
  return {
    ...grounded,
    mode: "agent",
    answer: terminalAnswer,
    summary:
      terminal.selectedProvider || terminal.selectedModel
        ? `answered with ${terminal.selectedProvider ?? "unknown"}/${terminal.selectedModel ?? "unknown"}`
        : grounded.summary,
    selectedProvider: terminal.selectedProvider,
    selectedModel: terminal.selectedModel,
    attempts: terminal.attempts,
  };
}

export function buildTerminalResult(params: {
  runId: string;
  result: DocAnswerResult;
  status?: DocsTerminalResult["status"];
}): DocsTerminalResult {
  return {
    runId: params.runId,
    status: params.status ?? "ok",
    mode: params.result.mode,
    answer: params.result.answer,
    summary: params.result.summary,
    citations: params.result.citations,
    selectedProvider: params.result.selectedProvider,
    selectedModel: params.result.selectedModel,
    answerSource: params.result.answerSource,
    memoryEntryId: params.result.memoryEntryId,
    reviewStatus: params.result.reviewStatus,
    followUpSource: params.result.followUpSource,
    continuedFromRunId: params.result.continuedFromRunId,
    rewrittenQuestion: params.result.rewrittenQuestion,
    attempts: params.result.attempts,
  };
}
