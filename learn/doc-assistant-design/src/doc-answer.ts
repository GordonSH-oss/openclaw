import { runLearningAgentCommand } from "../../agent-design/src/index.js";
import { detectAnswerLanguage, type AnswerLanguage } from "./answer-language.js";
import { buildAnswerPlan } from "./answer-plan.js";
import { buildAgentPromptFromPlan } from "./answer-render.js";
import type { ClarificationDecision } from "./clarification-policy.js";
import { detectDocShape, type DocSearchDocShape } from "./doc-shape.js";
import { buildEvidencePack, type EvidencePack } from "./evidence-pack.js";
import { answerWithOpenAICompatible } from "./openai-compatible.js";
import type {
  DocAnswerValidationResult,
  DocAnswerReviewStatus,
  DocAnswerSurface,
  DocAnswerSource,
  DocAssistantMode,
  DocCitation,
  DocFollowUpSource,
  DocSearchHit,
  DocsTerminalResult,
  OpenAICompatibleConfig,
} from "./protocol/index.js";
import { planDocQuestion, type DocQuestionPlan } from "./question-planning.js";
import {
  buildQuestionState,
  detectQuestionApiLayer,
  detectQuestionChannelKind,
  detectQuestionPlatform,
} from "./question-state.js";
import { resolveDocAssistantAgentScratchDataDir } from "./session-store.js";

// This module turns retrieved `DocSearchHit[]` into a grounded answer. `question-execution.ts`
// calls it after retrieval, clarification, and answerability checks, and the same grounded
// result is reused when building the final agent prompt.
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
  pendingClarificationQuestion?: string;
  pendingClarificationKind?: "platform" | "channel_kind" | "api_layer" | "product";
  clarificationHits?: DocSearchHit[];
  attempts?: Array<{
    provider: string;
    model: string;
    ok: boolean;
    reason?: string;
  }>;
  answerSurface?: DocAnswerSurface;
  validation?: DocAnswerValidationResult;
  trace?: Record<string, unknown>;
};

type DocPlatform = "android" | "ios" | "web" | "flutter";
type DocChannelKind = "direct" | "group" | "community" | "open";
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
  docShape: DocSearchDocShape;
};

type GroundedAnswerKind =
  | "clarification"
  | "concept"
  | "send_message"
  | "start_chat"
  | "channel_creation"
  | "generic_guide"
  | "insufficient"
  | "no_hit";

type GuideAnswerKind = Exclude<
  GroundedAnswerKind,
  "clarification" | "concept" | "no_hit" | "insufficient"
>;
type AgentRewritePolicy = "rewrite_allowed" | "bypass_agent";
type MessageSubtype = "text" | "image" | "file" | "voice" | "targeted" | "generic";

type GroundedAnswerResult = DocAnswerResult & {
  answerKind: GroundedAnswerKind;
  agentPolicy: AgentRewritePolicy;
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

const PROMPT_ECHO_MARKERS = [
  "you are a technical documentation assistant.",
  "retrieved documentation:",
  "question:",
  "a draft answer is provided below as a starting point.",
  "please stream the final answer between the sentinels below.",
  "final_answer_start",
  "final_answer_end",
  "你刚才说的是：",
];

function citationLabel(citation: DocCitation): string {
  const heading = citation.heading ? `#${citation.heading}` : "";
  return `${citation.path}${heading}:${citation.startLine}-${citation.endLine}`;
}

function renderSourcesAppendix(citations: DocCitation[]): string {
  if (citations.length === 0) {
    return "Sources:\n- none";
  }
  return ["Sources:", ...citations.map((citation) => `- ${citationLabel(citation)}`)].join("\n");
}

function stripListMarker(line: string): string {
  return line.replace(/^\s*-\s+/, "");
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

function isWebhookText(value: string): boolean {
  return normalizeAnswerText(value).includes("webhook");
}

function isWebhookHit(hit: Pick<DocSearchHit, "path" | "heading" | "text"> | undefined): boolean {
  if (!hit) {
    return false;
  }
  return isWebhookText([hit.path, hit.heading ?? "", hit.text].join("\n"));
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
  return detectQuestionPlatform(value);
}

function detectChannelKind(value: string): DocChannelKind | undefined {
  return detectQuestionChannelKind(value);
}

function formatChannelKind(kind: DocChannelKind): string {
  if (kind === "direct") {
    return "direct channel";
  }
  if (kind === "group") {
    return "group channel";
  }
  if (kind === "open") {
    return "open channel";
  }
  return "community channel / subchannel";
}

function detectExplicitQuestionChannelKind(question: string): DocChannelKind | undefined {
  return detectChannelKind(question);
}

function isExplicitServerApiQuestion(question: string): boolean {
  return detectQuestionApiLayer(question) === "server";
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

function isSendMessageQuestion(question: string): boolean {
  const normalized = normalizeAnswerText(question);
  return (
    normalized.includes("send") &&
    (normalized.includes("message") ||
      normalized.includes("text") ||
      normalized.includes("image") ||
      normalized.includes("file") ||
      normalized.includes("voice") ||
      normalized.includes("media") ||
      normalized.includes("targeted"))
  );
}

function isStartChatQuestion(question: string): boolean {
  const normalized = normalizeAnswerText(question);
  if (isSendMessageQuestion(question)) {
    return false;
  }
  return (
    (normalized.includes("start") ||
      normalized.includes("begin") ||
      normalized.includes("open") ||
      normalized.includes("chat")) &&
    (normalized.includes("chat") ||
      normalized.includes("channel") ||
      normalized.includes("conversation") ||
      normalized.includes("direct channel"))
  );
}

function isChannelCreationQuestion(question: string): boolean {
  const normalized = normalizeAnswerText(question);
  return (
    normalized.includes("create") &&
    (normalized.includes("channel") ||
      normalized.includes("conversation") ||
      normalized.includes("group") ||
      normalized.includes("community") ||
      normalized.includes("subchannel"))
  );
}

function isEndActionQuestion(question: string): boolean {
  const normalized = normalizeAnswerText(question);
  return (
    normalized.includes("delete") ||
    normalized.includes("remove") ||
    normalized.includes("destroy") ||
    normalized.includes("leave") ||
    normalized.includes("exit")
  );
}

function isOperationalEndActionHit(hit: AnalyzedHit): boolean {
  const normalized = normalizeAnswerText([hit.heading ?? "", hit.text].join("\n"));
  const hasOperationSignal =
    normalized.includes("exitchannel") ||
    normalized.includes("leave an open channel") ||
    normalized.includes("leave the channel") ||
    normalized.includes("channel delete") ||
    normalized.includes("delete a single channel") ||
    normalized.includes("delete multiple channels") ||
    normalized.includes("remove a specific channel");
  const hasReferenceNoise =
    normalized.includes("event") ||
    normalized.includes("handler") ||
    normalized.includes("metadata") ||
    normalized.includes("delegate") ||
    normalized.includes("delegation");
  return hasOperationSignal && !hasReferenceNoise;
}

function buildEndActionClarifyingNote(
  question: string,
  hits: AnalyzedHit[],
  language: AnswerLanguage,
): string | undefined {
  // Retrieval can correctly land on "leave/exit" docs even when the user says "destroy". When
  // that happens, keep the answer explicit that the client SDK is documenting an exit flow rather
  // than silently pretending a destroy API exists.
  const normalizedQuestion = normalizeAnswerText(question);
  const asksForDestructiveAction =
    normalizedQuestion.includes("destroy") ||
    normalizedQuestion.includes("delete") ||
    normalizedQuestion.includes("remove");
  if (!asksForDestructiveAction) {
    return undefined;
  }

  const leaveHit = hits.find((hit) => {
    const normalized = normalizeAnswerText([hit.heading ?? "", hit.text].join("\n"));
    return (
      normalized.includes("leave an open channel") ||
      normalized.includes("active leave") ||
      normalized.includes("exitchannel")
    );
  });
  if (!leaveHit) {
    return undefined;
  }

  return language === "en"
    ? `- The retrieved client-side docs describe leaving the open channel with \`exitChannel(...)\`; they do not document a client-side API that destroys the channel itself.${inlineCitation(leaveHit)}`
    : `- 当前命中的客户端文档描述的是通过 \`exitChannel(...)\` 离开 open channel；它们没有给出客户端直接销毁该 channel 的 API。${inlineCitation(leaveHit)}`;
}

function wantsEndToEndSdkFlow(question: string): boolean {
  const normalized = normalizeAnswerText(question);
  return (
    normalized.includes("from scratch") ||
    normalized.includes("quickstart") ||
    normalized.includes("setup") ||
    normalized.includes("set up") ||
    normalized.includes("import") ||
    normalized.includes("initialize") ||
    normalized.includes("connect")
  );
}

function detectMessageSubtypeFromText(text: string): MessageSubtype {
  const normalized = normalizeAnswerText(text);
  if (normalized.includes("targeted message") || normalized.includes("directeduserids")) {
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
  return "generic";
}

function detectMessageSubtype(
  question: string,
  hit?: Pick<DocSearchHit, "path" | "heading" | "text">,
): MessageSubtype {
  const fromQuestion = detectMessageSubtypeFromText(question);
  if (fromQuestion !== "generic") {
    return fromQuestion;
  }
  if (!hit) {
    return "generic";
  }
  return detectMessageSubtypeFromText([hit.path, hit.heading ?? "", hit.text].join("\n"));
}

function formatMessageSubtype(subtype: MessageSubtype, language: AnswerLanguage): string {
  if (language === "en") {
    if (subtype === "text") {
      return "a text message";
    }
    if (subtype === "image") {
      return "an image message";
    }
    if (subtype === "file") {
      return "a file message";
    }
    if (subtype === "voice") {
      return "a voice message";
    }
    if (subtype === "targeted") {
      return "a targeted message";
    }
    return "a message";
  }
  if (subtype === "text") {
    return "文本消息";
  }
  if (subtype === "image") {
    return "图片消息";
  }
  if (subtype === "file") {
    return "文件消息";
  }
  if (subtype === "voice") {
    return "语音消息";
  }
  if (subtype === "targeted") {
    return "定向消息";
  }
  return "消息";
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

function orderPlatforms(platforms: DocPlatform[]): DocPlatform[] {
  const rank: Record<DocPlatform, number> = {
    android: 0,
    ios: 1,
    web: 2,
    flutter: 3,
  };
  return platforms.slice().toSorted((left, right) => rank[left] - rank[right]);
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
    /\bSendImageMessageParams\b/g,
    /\bSendFileMessageParams\b/g,
    /\bSendVoiceMessageParams\b/g,
    /\bSendMediaMessageParams\b/g,
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
  const webhookPage = normalized.includes("webhook");
  const serverApiPage =
    (!webhookPage && normalizedHeadingPath.includes("platform chat api")) ||
    normalizedHeadingPath.includes("chat server api list");
  const canonicalDefinitionPage =
    !serverApiPage &&
    (normalizedHeadingPath.includes("about ") ||
      normalizedHeadingPath.startsWith("what is ") ||
      normalizedHeadingPath.startsWith("what are ") ||
      normalizedHeadingPath.includes("glossary") ||
      normalizedHeadingPath.includes("offline messages") ||
      normalizedHeadingPath.includes("missed messages") ||
      normalizedHeadingPath.includes("community channel overview") ||
      normalizedHeadingPath.includes("community channels overview") ||
      ((normalizedHeadingPath.includes("community channel") ||
        normalizedHeadingPath.includes("community channels")) &&
        normalizedHeadingPath.includes("overview") &&
        (normalizedBody.includes(" is a ") ||
          normalizedBody.includes(" are ") ||
          normalizedBody.includes(" refers to ") ||
          normalizedBody.includes(" used for ") ||
          normalizedBody.includes(" enables ") ||
          normalizedBody.includes("key features") ||
          normalizedBody.includes("main features") ||
          normalizedBody.includes("no member limit"))));

  if (
    canonicalDefinitionPage ||
    normalizedBody.includes(" is a ") ||
    normalizedBody.includes(" are ") ||
    normalizedBody.includes(" refers to ")
  ) {
    return "definition";
  }

  if (
    (((!webhookPage && normalized.includes("platform chat api")) ||
      normalized.includes("server api")) &&
      !(
        normalizedHeadingPath.includes("creating community channels") ||
        normalizedHeadingPath.includes("creating community channel") ||
        normalizedHeadingPath.includes("creating channel") ||
        normalizedBody.includes("does not provide client side apis")
      )) ||
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
    normalizedHeadingPath.includes("set up") ||
    normalizedHeadingPath.includes("setup") ||
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

  if (
    normalizedHeadingPath.includes("direct channel") ||
    normalizedBody.includes("direct channel")
  ) {
    return "start_chat";
  }

  if (
    normalizedHeadingPath.includes("channel overview") ||
    normalizedHeadingPath.includes("overview")
  ) {
    return "platform";
  }

  return "reference";
}

function getBucketHits(hits: DocSearchHit[], bucket: "concept" | "procedural"): DocSearchHit[] {
  return hits.filter((hit) => hit.retrievalBucket === bucket);
}

function pickPlanStepQuestion(
  plan: DocQuestionPlan,
  intent: "concept" | "procedural",
  fallbackQuestion: string,
): string {
  return plan.steps.find((step) => step.intent === intent)?.question ?? fallbackQuestion;
}

function extractConceptFocusTerms(question: string): string[] {
  const normalized = normalizeAnswerText(question);
  let stripped = normalized;
  for (const marker of CONCEPT_MARKER_TERMS) {
    stripped = stripped.replace(marker, " ");
  }
  stripped = stripped
    .replace(/\bis\b/g, " ")
    .replace(/\bare\b/g, " ")
    .trim();
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
    normalizedHeadingPath.includes("overview") ||
    normalizedHeadingPath.includes("glossary") ||
    normalizedHeadingPath.includes("about ") ||
    normalizedHeadingPath.includes("what is ") ||
    normalizedSnippet.includes(" is a ") ||
    normalizedSnippet.includes(" refers to ") ||
    normalizedSnippet.includes(" used for ") ||
    normalizedBody.includes(" used for ") ||
    normalizedBody.includes(" is a ") ||
    normalizedBody.includes(" refers to ");
  const hasOverviewFocusSignal =
    normalizedHeadingPath.includes("overview") && hasFocusInHeadingPath;

  if (!hasFocusInVisibleText) {
    return false;
  }
  if (focusTerms.length === 1) {
    const focusTerm = focusTerms[0];
    const hasDirectDefinitionSentence =
      normalizedSnippet.includes(`${focusTerm} is `) ||
      normalizedSnippet.includes(`${focusTerm} refers to `) ||
      normalizedSnippet.includes(`${focusTerm} means `) ||
      normalizedBody.includes(`${focusTerm} is `) ||
      normalizedBody.includes(`${focusTerm} refers to `) ||
      normalizedBody.includes(`${focusTerm} means `);
    return (
      (hasDefinitionSignal || hasOverviewFocusSignal) &&
      (hasFocusInHeadingPath || hasDirectDefinitionSentence)
    );
  }
  return (hasDefinitionSignal || hasOverviewFocusSignal) && hasFocusInHeadingPath;
}

function analyzeHits(
  question: string,
  hits: DocSearchHit[],
): {
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
  const explicitChannelKind = detectExplicitQuestionChannelKind(question);
  const analyzedHits = hits.map((hit) => ({
    ...hit,
    platform:
      detectPlatform(hit.path) ?? detectPlatform(hit.heading ?? "") ?? detectPlatform(hit.text),
    channelKind:
      detectChannelKind(hit.path) ??
      detectChannelKind(hit.heading ?? "") ??
      detectChannelKind(hit.text),
    role: classifyHitRole(hit),
    docShape: hit.docShape ?? detectDocShape(hit),
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
    !explicitChannelKind && mentionsChannelCreationTopic && foundChannelKinds.length > 1;

  let selectedChannelKind = explicitChannelKind;
  if (!selectedChannelKind && isChannelFocusedQuestion(question) && foundChannelKinds.length > 0) {
    selectedChannelKind = channelHits
      .slice()
      .toSorted((left, right) => right.score - left.score)[0]?.channelKind;
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
    normalizedQuestion.includes("community channel") ||
    normalizedQuestion.includes("subchannel") ||
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
      .toSorted((left, right) => right.score - left.score)[0]?.platform;
  }

  const usedHits = (
    selectedPlatform
      ? channelScopedHits.filter((hit) => hit.platform === selectedPlatform || !hit.platform)
      : channelScopedHits
  ).toSorted((left, right) => right.score - left.score);

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
    .toSorted((left, right) => right.score - left.score)[0];
}

function pickBestSendHit(question: string, hits: AnalyzedHit[]): AnalyzedHit | undefined {
  const requestedSubtype = detectMessageSubtype(question);
  const sendHits = hits.filter((hit) => hit.role === "send_first_message");
  if (requestedSubtype === "generic") {
    const defaultTextHit = sendHits
      .filter((hit) => {
        const normalizedHeadingPath = normalizeAnswerText([hit.path, hit.heading ?? ""].join("\n"));
        if (
          normalizedHeadingPath.includes("send a text message") ||
          normalizedHeadingPath.includes("send a regular message")
        ) {
          return true;
        }
        if (
          normalizedHeadingPath.includes("send an image message") ||
          normalizedHeadingPath.includes("send a file message") ||
          normalizedHeadingPath.includes("send a voice message") ||
          normalizedHeadingPath.includes("send a targeted message")
        ) {
          return false;
        }
        const subtype = detectMessageSubtypeFromText([hit.heading ?? "", hit.text].join("\n"));
        return subtype === "text" || subtype === "generic";
      })
      .toSorted((left, right) => {
        const scoreHit = (hit: AnalyzedHit): number => {
          const normalized = normalizeAnswerText([hit.path, hit.heading ?? ""].join("\n"));
          let score = hit.score;
          if (hit.docShape === "specialized_task") {
            score += 24;
          }
          if (hit.docShape === "quickstart_step") {
            score -= 18;
          }
          if (normalized.includes("read receipt")) {
            score -= 12;
          }
          if (
            normalized.includes("send a text message") ||
            normalized.includes("send a regular message")
          ) {
            score += 16;
          }
          if (
            normalized.includes("send an image message") ||
            normalized.includes("send a file message") ||
            normalized.includes("send a voice message")
          ) {
            score -= 8;
          }
          return score;
        };
        return scoreHit(right) - scoreHit(left);
      })[0];
    if (defaultTextHit) {
      return defaultTextHit;
    }
  }
  return sendHits.toSorted((left, right) => {
    const scoreDocShape = (hit: AnalyzedHit): number => {
      if (hit.docShape === "specialized_task") {
        return 4;
      }
      if (hit.docShape === "quickstart_step") {
        return 1;
      }
      return 0;
    };
    const scoreStructure = (hit: AnalyzedHit): number => {
      const normalizedHeadingPath = normalizeAnswerText([hit.path, hit.heading ?? ""].join("\n"));
      let score = 0;
      if (
        normalizedHeadingPath.includes("/message/") ||
        normalizedHeadingPath.includes("message send")
      ) {
        score += 3;
      }
      if (
        normalizedHeadingPath.includes("send a text message") ||
        normalizedHeadingPath.includes("send a regular message") ||
        normalizedHeadingPath.includes("send an image message") ||
        normalizedHeadingPath.includes("send a file message") ||
        normalizedHeadingPath.includes("send a voice message") ||
        normalizedHeadingPath.includes("send a media message") ||
        normalizedHeadingPath.includes("send a targeted message")
      ) {
        score += 2;
      }
      if (normalizedHeadingPath.includes("step ")) {
        score -= 1;
      }
      return score;
    };
    const scoreSubtype = (hit: AnalyzedHit): number => {
      const subtype = detectMessageSubtypeFromText([hit.heading ?? "", hit.text].join("\n"));
      if (requestedSubtype !== "generic") {
        if (subtype === requestedSubtype) {
          return 3;
        }
        if (
          requestedSubtype === "image" &&
          normalizeAnswerText([hit.heading ?? "", hit.text].join("\n")).includes("media message")
        ) {
          return 2;
        }
        return 0;
      }
      if (subtype === "text" || subtype === "generic") {
        return 2;
      }
      if (subtype === "targeted") {
        return 1;
      }
      return 0;
    };
    const shapeDelta = scoreDocShape(right) - scoreDocShape(left);
    if (shapeDelta !== 0) {
      return shapeDelta;
    }
    const structureDelta = scoreStructure(right) - scoreStructure(left);
    if (structureDelta !== 0) {
      return structureDelta;
    }
    const subtypeDelta = scoreSubtype(right) - scoreSubtype(left);
    if (subtypeDelta !== 0) {
      return subtypeDelta;
    }
    return right.score - left.score;
  })[0];
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
    .toSorted((left, right) => right.score - left.score)[0];
}

function buildClarificationAnswer(
  question: string,
  analysis: ReturnType<typeof analyzeHits>,
  language: AnswerLanguage,
): GroundedAnswerResult {
  const platformHits = analysis.relevantHits.filter((hit) => hit.platform !== undefined);
  const normalizedQuestion = normalizeAnswerText(question);
  const bestByPlatform = new Map<DocPlatform, AnalyzedHit>();
  const rankedPlatformHits = platformHits.toSorted((left, right) => {
    const scoreHit = (hit: AnalyzedHit): number => {
      const normalized = normalizeAnswerText([hit.path, hit.heading ?? ""].join("\n"));
      let score = hit.score;
      if (hit.docShape === "specialized_task") {
        score += 30;
      }
      if (hit.docShape === "quickstart_step") {
        score -= 12;
      }
      if (
        (normalizedQuestion.includes("send") || normalizedQuestion.includes("first message")) &&
        (normalized.includes("send a text message") ||
          normalized.includes("send a regular message"))
      ) {
        score += 28;
      }
      if (normalizedQuestion.includes("direct chat") && normalized.includes("direct channel")) {
        score += 24;
      }
      return score;
    };
    return scoreHit(right) - scoreHit(left);
  });
  for (const hit of rankedPlatformHits) {
    if (hit.platform && !bestByPlatform.has(hit.platform)) {
      bestByPlatform.set(hit.platform, hit);
    }
  }
  const citations = dedupeCitations(Array.from(bestByPlatform.values()));
  const platformText = analysis.foundPlatforms
    .map((platform) => formatPlatform(platform))
    .join(" / ");
  const examples = Array.from(bestByPlatform.entries()).map(
    ([platform, hit]) =>
      `- ${formatPlatform(platform)}: ${hit.heading ?? hit.path} ${inlineCitation(hit)}`,
  );

  return {
    mode: "extractive",
    answer: [
      language === "en"
        ? `This question depends on the target platform. Choose ${platformText}, and the answer can be narrowed to the matching implementation steps.`
        : `这是一个和平台相关的问题。请告诉我你要看 ${platformText} 中的哪一个平台，我会按对应平台整理开始聊天的步骤。`,
      normalizedQuestion.includes("direct channel")
        ? language === "en"
          ? "In these SDK docs, a one-to-one chat is typically represented by a `DirectChannel` object."
          : "在这些 SDK 文档里，一对一聊天通常会通过 `DirectChannel` 对象来表示。"
        : "",
      examples.length > 0
        ? [language === "en" ? "Relevant doc entry points:" : "相关文档入口：", ...examples].join(
            "\n",
          )
        : "",
      renderSourcesAppendix(citations),
    ]
      .filter(Boolean)
      .join("\n\n"),
    summary: "platform clarification required",
    citations,
    answerKind: "clarification",
    agentPolicy: "bypass_agent",
    answerSource: "generated",
    reviewStatus: "not_applicable",
    pendingClarificationQuestion: question,
    pendingClarificationKind: "platform",
    clarificationHits: analysis.relevantHits,
  };
}

function buildChannelClarificationAnswer(
  question: string,
  analysis: ReturnType<typeof analyzeHits>,
  language: AnswerLanguage,
): GroundedAnswerResult {
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
    ([kind, hit]) =>
      `- ${formatChannelKind(kind)}: ${hit.heading ?? hit.path} ${inlineCitation(hit)}`,
  );

  return {
    mode: "extractive",
    answer: [
      language === "en"
        ? `In these docs, "channel" can mean ${kindText}. Specify which one you need, and the answer can be narrowed to the matching implementation steps.`
        : `这个问题里的 channel 可能指 ${kindText}。请告诉我你要看哪一类，我再按对应文档整理开发步骤。`,
      examples.length > 0
        ? [language === "en" ? "Relevant doc entry points:" : "相关文档入口：", ...examples].join(
            "\n",
          )
        : "",
      renderSourcesAppendix(citations),
    ]
      .filter(Boolean)
      .join("\n\n"),
    summary: "channel clarification required",
    citations,
    answerKind: "clarification",
    agentPolicy: "bypass_agent",
    answerSource: "generated",
    reviewStatus: "not_applicable",
    pendingClarificationQuestion: question,
    pendingClarificationKind: "channel_kind",
    clarificationHits: analysis.analyzedHits,
  };
}

function buildApiLayerClarificationAnswer(
  question: string,
  hits: DocSearchHit[],
  language: AnswerLanguage,
): GroundedAnswerResult {
  const categorized = new Map<"client" | "server", DocSearchHit>();
  for (const hit of hits) {
    const apiLayer = detectQuestionApiLayer([hit.path, hit.heading ?? "", hit.text].join("\n"));
    if (apiLayer && !categorized.has(apiLayer)) {
      categorized.set(apiLayer, hit);
    }
  }
  const citations = dedupeCitations(Array.from(categorized.values()));
  const examples = Array.from(categorized.entries()).map(
    ([kind, hit]) =>
      `- ${kind === "client" ? "Client SDK" : "Server API"}: ${hit.heading ?? hit.path} ${inlineCitation(hit)}`,
  );

  return {
    mode: "extractive",
    answer: [
      language === "en"
        ? "This question is ambiguous between the client SDK flow and the Server API path. Tell me which one you need and I will narrow the implementation path."
        : "这个问题同时可能指客户端 SDK 流程，也可能指 Server API 路径。请告诉我你要看哪一种，我再收敛到对应步骤。",
      examples.length > 0
        ? [language === "en" ? "Relevant doc entry points:" : "相关文档入口：", ...examples].join(
            "\n",
          )
        : "",
      renderSourcesAppendix(citations),
    ]
      .filter(Boolean)
      .join("\n\n"),
    summary: "api layer clarification required",
    citations,
    answerKind: "clarification",
    agentPolicy: "bypass_agent",
    answerSource: "generated",
    reviewStatus: "not_applicable",
    pendingClarificationQuestion: question,
    pendingClarificationKind: "api_layer",
    clarificationHits: hits,
  };
}

export function renderClarificationAnswer(params: {
  decision: ClarificationDecision;
  question: string;
  hits: DocSearchHit[];
  language?: AnswerLanguage;
  mode: DocAssistantMode;
}): DocAnswerResult {
  const language = params.language ?? detectAnswerLanguage(params.question, params.hits);
  if (params.decision.kind === "api_layer") {
    return buildApiLayerClarificationAnswer(params.question, params.hits, language);
  }

  const analysis = analyzeHits(params.question, params.hits);
  if (params.decision.kind === "channel_kind") {
    return buildChannelClarificationAnswer(params.question, analysis, language);
  }

  return buildClarificationAnswer(params.question, analysis, language);
}

function buildNoHitAnswer(question: string, language: AnswerLanguage): GroundedAnswerResult {
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
    answerKind: "no_hit",
    agentPolicy: "bypass_agent",
    answerSource: "generated",
    reviewStatus: "not_applicable",
  };
}

// Called from `question-execution.ts` when `answerability.ts` or validation concludes that the
// retrieved hits are too weak to support a grounded answer.
export function buildInsufficientEvidenceAnswer(
  question: string,
  language: AnswerLanguage,
  reason?: string,
): GroundedAnswerResult {
  return {
    mode: "extractive",
    answer: [
      language === "en"
        ? `The retrieved local documentation does not contain enough evidence to answer "${question}" reliably.`
        : `当前检索到的本地文档不足以可靠回答“${question}”。`,
      reason
        ? language === "en"
          ? `Why this was not answered: ${reason}.`
          : `未直接作答的原因：${reason}。`
        : language === "en"
          ? "Try a more specific query, or add documentation that explicitly covers this task."
          : "你可以换更具体的关键词，或者补充明确覆盖这个任务的文档。",
      renderSourcesAppendix([]),
    ].join("\n\n"),
    summary: "insufficient documentation evidence",
    citations: [],
    answerKind: "insufficient",
    agentPolicy: "bypass_agent",
    answerSource: "generated",
    reviewStatus: "not_applicable",
  };
}

function buildGuideIntro(params: {
  language: AnswerLanguage;
  answerKind: GuideAnswerKind;
  platform?: DocPlatform;
  channelKind?: DocChannelKind;
  messageSubtype?: MessageSubtype;
  primaryHit?: AnalyzedHit;
  overviewHit?: AnalyzedHit;
  setupHit?: AnalyzedHit;
  connectHit?: AnalyzedHit;
  channelHit?: AnalyzedHit;
  sendHit?: AnalyzedHit;
}): string {
  const citation = params.overviewHit ? ` ${inlineCitation(params.overviewHit)}` : "";
  const platformText = params.platform ? formatPlatform(params.platform) : undefined;
  const genericFriendlyMessageSubtype =
    params.messageSubtype === "text"
      ? params.language === "en"
        ? "a message"
        : "消息"
      : formatMessageSubtype(params.messageSubtype ?? "generic", params.language);
  const webhookGuide = [
    params.overviewHit,
    params.setupHit,
    params.connectHit,
    params.channelHit,
    params.sendHit,
  ].some((hit) => isWebhookHit(hit));
  if (params.language === "en") {
    if (webhookGuide) {
      return `Use the documented flow below to configure webhooks.${citation}`;
    }
    const onPlatform = platformText ? ` on ${platformText}` : "";
    if (params.primaryHit?.docShape === "quickstart_step") {
      if (params.answerKind === "send_message") {
        return `The best available evidence here is a quickstart step for sending ${genericFriendlyMessageSubtype}${onPlatform}, so treat it as an entry point inside the larger SDK tutorial.${citation}`;
      }
      return `The best available evidence here comes from a quickstart step${onPlatform}, so the guidance below is an entry point within the larger SDK tutorial.${citation}`;
    }
    if (params.answerKind === "send_message") {
      return `Use the documented flow below to send ${genericFriendlyMessageSubtype}${onPlatform}.${citation}`;
    }
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
  if (webhookGuide) {
    return `下面是配置 Webhook 的文档步骤。${citation}`;
  }
  if (params.primaryHit?.docShape === "quickstart_step") {
    return `当前最匹配的证据来自 quickstart 子步骤${params.platform ? `（${formatPlatform(params.platform)}）` : ""}，所以下面的内容是教程入口，不是完整的独立任务页。${citation}`;
  }
  if (params.answerKind === "send_message") {
    return `下面是发送${genericFriendlyMessageSubtype}${params.platform ? `的 ${formatPlatform(params.platform)} 文档步骤` : "的文档步骤"}。${citation}`;
  }
  if (params.platform && (params.channelHit || params.sendHit)) {
    return `下面是 ${formatPlatform(params.platform)} 的对应文档步骤，用来开始当前聊天流程。${citation}`;
  }
  return `下面是当前问题对应的文档步骤。${citation}`;
}

function buildNeedLine(hit: AnalyzedHit, language: AnswerLanguage): string {
  const normalized = normalizeAnswerText([hit.path, hit.heading ?? "", hit.text].join("\n"));
  if (isWebhookHit(hit)) {
    return language === "en"
      ? `- Prepare a reachable webhook callback URL before you configure the Nexconn Console settings.${inlineCitation(hit)}`
      : `- 先准备一个可访问的 webhook 回调 URL，再去配置 Nexconn Console。${inlineCitation(hit)}`;
  }
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
    const term =
      extractCodeTerms(hit.text).find((value) => value.includes("initialize")) ??
      "NCEngine.initialize()";
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

function buildStepLine(
  hit: AnalyzedHit,
  language: AnswerLanguage,
  options: {
    answerKind: GuideAnswerKind;
    question: string;
  },
): string {
  const normalized = normalizeAnswerText([hit.path, hit.heading ?? "", hit.text].join("\n"));
  const codeTerms = extractCodeTerms([hit.heading ?? "", hit.text].join("\n"));
  const directChannel =
    codeTerms.find((value) => value.includes("DirectChannel"))?.replace(/\(.*/, "") ??
    "DirectChannel";
  const initialize =
    codeTerms.find((value) => value.includes("initialize")) ?? "NCEngine.initialize()";
  const sendParams =
    codeTerms.find((value) => value.includes("SendTextMessageParams"))?.replace(/\(.*/, "") ??
    "SendTextMessageParams";
  const sendMethod =
    codeTerms.find((value) => value.includes("sendMessage")) ?? "channel.sendMessage(...)";
  const initializeCall =
    codeTerms.find((value) => value.includes("NCEngine.initialize")) ?? initialize;
  const connectCall =
    codeTerms.find((value) => value.includes("connect")) ?? "NCEngine.connect(...)";
  const targetedField =
    codeTerms.find((value) => value.includes("directedUserIds")) ?? "directedUserIds";
  const messageSubtype = detectMessageSubtype(options.question, hit);
  const messageParams = pickMessageParamsTerm(codeTerms, messageSubtype);
  const mentionsDirectChannel = normalizeAnswerText(options.question).includes("direct channel");

  if (isWebhookHit(hit)) {
    if (
      normalized.includes("set up webhook") ||
      normalized.includes("setup webhook") ||
      normalized.includes("webhook url") ||
      normalized.includes("callback url") ||
      normalized.includes("select the events") ||
      normalized.includes("config")
    ) {
      return language === "en"
        ? `Open the Webhooks settings, click Config, enter the callback URL, choose the events to deliver, and save the webhook configuration.${inlineCitation(hit)}`
        : `打开 Webhooks 设置并点击 Config，填写回调 URL，选择要投递的事件，然后保存配置。${inlineCitation(hit)}`;
    }
    if (normalized.includes("signature")) {
      return language === "en"
        ? `Verify the webhook signature on your server before you trust the callback payload.${inlineCitation(hit)}`
        : `在服务端处理回调前，先校验 webhook signature。${inlineCitation(hit)}`;
    }
    if (normalized.includes("event") || normalized.includes("payload")) {
      return language === "en"
        ? `Handle the webhook event payload on your server according to the documented event schema.${inlineCitation(hit)}`
        : `按照文档里的事件结构处理服务端收到的 webhook payload。${inlineCitation(hit)}`;
    }
    return language === "en"
      ? `Configure the webhook endpoint and delivery behavior exactly as documented.${inlineCitation(hit)}`
      : `按文档说明配置 webhook 端点和投递行为。${inlineCitation(hit)}`;
  }

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
    if (options.answerKind === "channel_creation" && normalized.includes("directchannel")) {
      return language === "en"
        ? `Create \`${directChannel}("<target-user-id>")\` as the one-to-one conversation object for the target user.${inlineCitation(hit)}`
        : `创建 \`${directChannel}("<target-user-id>")\` 作为与目标用户的一对一会话对象。${inlineCitation(hit)}`;
    }

    if (normalized.includes("directeduserids")) {
      return language === "en"
        ? `Create \`${messageParams ?? sendParams}\`, set \`${targetedField}\` to the target members, then call \`${sendMethod}\` to send the targeted message.${inlineCitation(hit)}`
        : `构造 \`${messageParams ?? sendParams}\`，设置 \`${targetedField}\` 指定目标成员，然后调用 \`${sendMethod}\` 发送定向消息。${inlineCitation(hit)}`;
    }

    if (messageSubtype === "text") {
      if (options.answerKind === "start_chat" && normalized.includes("directchannel")) {
        return language === "en"
          ? `Create \`${directChannel}("<target-user-id>")\`, then build \`${messageParams ?? sendParams}\` and call \`${sendMethod}\` to send the first message.${inlineCitation(hit)}`
          : `创建 \`${directChannel}("<target-user-id>")\`，再构造 \`${messageParams ?? sendParams}\` 并调用 \`${sendMethod}\` 发送第一条消息。${inlineCitation(hit)}`;
      }
      return language === "en"
        ? `Build \`${messageParams ?? sendParams}\`, then call \`${sendMethod}\` to send the text message.${inlineCitation(hit)}`
        : `构造 \`${messageParams ?? sendParams}\`，然后调用 \`${sendMethod}\` 发送文本消息。${inlineCitation(hit)}`;
    }

    if (messageSubtype === "image") {
      return language === "en"
        ? `${messageParams ? `Build \`${messageParams}\`, then ` : ""}call \`${sendMethod}\` to send the image message.${inlineCitation(hit)}`
        : `${messageParams ? `构造 \`${messageParams}\`，然后` : ""}调用 \`${sendMethod}\` 发送图片消息。${inlineCitation(hit)}`;
    }

    if (messageSubtype === "file") {
      return language === "en"
        ? `${messageParams ? `Build \`${messageParams}\`, then ` : ""}call \`${sendMethod}\` to send the file message.${inlineCitation(hit)}`
        : `${messageParams ? `构造 \`${messageParams}\`，然后` : ""}调用 \`${sendMethod}\` 发送文件消息。${inlineCitation(hit)}`;
    }

    if (messageSubtype === "voice") {
      return language === "en"
        ? `${messageParams ? `Build \`${messageParams}\`, then ` : ""}call \`${sendMethod}\` to send the voice message.${inlineCitation(hit)}`
        : `${messageParams ? `构造 \`${messageParams}\`，然后` : ""}调用 \`${sendMethod}\` 发送语音消息。${inlineCitation(hit)}`;
    }

    if (
      options.answerKind === "start_chat" &&
      normalized.includes("directchannel") &&
      mentionsDirectChannel
    ) {
      return language === "en"
        ? `Create \`${directChannel}("<target-user-id>")\`, then call \`${sendMethod}\` to send the message.${inlineCitation(hit)}`
        : `创建 \`${directChannel}("<target-user-id>")\`，然后调用 \`${sendMethod}\` 发送消息。${inlineCitation(hit)}`;
    }
    return language === "en"
      ? `${messageParams ? `Build \`${messageParams}\`, then ` : ""}call \`${sendMethod}\` to send the message.${inlineCitation(hit)}`
      : `${messageParams ? `构造 \`${messageParams}\`，然后` : ""}调用 \`${sendMethod}\` 发送消息。${inlineCitation(hit)}`;
  }

  return language === "en"
    ? `Complete this step as documented in ${hit.heading ?? hit.path}.${inlineCitation(hit)}`
    : `按 ${hit.heading ?? hit.path} 中的说明完成这一步。${inlineCitation(hit)}`;
}

function buildConceptKeyPoint(hit: AnalyzedHit, language: AnswerLanguage): string {
  const normalized = normalizeAnswerText([hit.heading ?? "", hit.text].join("\n"));
  if (
    normalized.includes("retain") ||
    normalized.includes("retention") ||
    normalized.includes("7 days")
  ) {
    return language === "en"
      ? `- The server retains undelivered messages while the user is offline. Use the documented retention window to understand how long those messages can still be delivered.${inlineCitation(hit)}`
      : `- 服务端会在离线期间保留未投递消息；如果文档提到了保留时长或窗口期，可以按该配置理解消息补投行为。${inlineCitation(hit)}`;
  }
  if (
    normalized.includes("reconnect") ||
    normalized.includes("come online") ||
    normalized.includes("online")
  ) {
    return language === "en"
      ? `- When the user reconnects within that retention window, Nexconn pushes the queued offline messages back to the client.${inlineCitation(hit)}`
      : `- 当用户重新上线并在保留窗口内 reconnect 时，Nexconn 会把这段离线期间积压的消息补发给客户端。${inlineCitation(hit)}`;
  }
  if (
    normalized.includes("console") ||
    normalized.includes("setting") ||
    normalized.includes("retention period")
  ) {
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
): GroundedAnswerResult {
  const plan = planDocQuestion(question);
  const conceptQuestion = pickPlanStepQuestion(plan, "concept", question);
  const conceptHits = getBucketHits(hits, "concept");
  const analysis = analyzeHits(conceptQuestion, conceptHits.length > 0 ? conceptHits : hits);
  const effectiveHits = analysis.usedHits.length > 0 ? analysis.usedHits : analysis.relevantHits;
  if (effectiveHits.length === 0) {
    return buildNoHitAnswer(conceptQuestion, language);
  }

  const topOverviewHit = effectiveHits.find((hit) =>
    normalizeAnswerText([hit.path, hit.heading ?? ""].join("\n")).includes("overview"),
  );
  const definitionHit =
    (topOverviewHit && looksLikeDefinitionEvidence(conceptQuestion, topOverviewHit)
      ? topOverviewHit
      : undefined) ??
    pickBestHitByPredicate(
      effectiveHits,
      (hit, normalizedHeadingPath, normalizedBody) =>
        normalizedHeadingPath.includes("overview") &&
        (hit.score >= effectiveHits[0].score - 16 ||
          normalizedBody.includes("large communities") ||
          normalizedBody.includes("subchannel")),
    ) ??
    pickBestHit(effectiveHits, ["definition"]) ??
    pickBestHitByPredicate(
      effectiveHits,
      (_hit, normalizedHeadingPath) =>
        normalizedHeadingPath.includes("overview") ||
        normalizedHeadingPath.includes("about ") ||
        normalizedHeadingPath.includes("glossary") ||
        normalizedHeadingPath.includes("offline messages") ||
        normalizedHeadingPath.includes("missed messages"),
    ) ??
    effectiveHits[0];

  if (!looksLikeDefinitionEvidence(conceptQuestion, definitionHit)) {
    return {
      mode: "extractive",
      answer: [
        language === "en"
          ? `I couldn't find reliable local documentation that directly defines "${conceptQuestion}".`
          : `我没有在当前本地文档里找到能够直接定义“${conceptQuestion}”的可靠内容。`,
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
      answerKind: "no_hit",
      agentPolicy: "bypass_agent",
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
      [
        sectionLabel(language, "definition"),
        `- ${definitionHit.snippet}${inlineCitation(definitionHit)}`,
      ].join("\n"),
      supportingHits.length > 0
        ? [
            sectionLabel(language, "keyPoints"),
            ...supportingHits.map((hit) => buildConceptKeyPoint(hit, language)),
          ].join("\n")
        : "",
      noteLines.length > 0 ? [sectionLabel(language, "notes"), ...noteLines].join("\n") : "",
      renderSourcesAppendix(citations),
    ]
      .filter(Boolean)
      .join("\n\n"),
    summary: `concept answer from ${citations.length} documentation chunks`,
    citations,
    answerKind: "concept",
    agentPolicy: "rewrite_allowed",
    answerSource: "generated",
    reviewStatus: "not_applicable",
  };
}

function buildPlatformClarificationNote(
  analysis: ReturnType<typeof analyzeHits>,
  language: AnswerLanguage,
): string {
  const platformText = orderPlatforms(analysis.foundPlatforms)
    .map((platform) => formatPlatform(platform))
    .join(" / ");
  if (language === "en") {
    return `- The remaining client-side implementation differs by platform. Choose ${platformText} for the SDK-specific continuation.`;
  }
  return `- 剩余的客户端实现步骤和平台相关。请从 ${platformText} 中指定一个平台，我再继续补全对应 SDK 的实现入口。`;
}

function buildCommunityCreationServerRule(
  question: string,
  hits: AnalyzedHit[],
  language: AnswerLanguage,
): { line: string; hit?: AnalyzedHit } | undefined {
  const normalizedQuestion = normalizeAnswerText(question);
  const isCommunityCreationQuestion =
    normalizedQuestion.includes("create") &&
    (normalizedQuestion.includes("community channel") || normalizedQuestion.includes("subchannel"));
  if (!isCommunityCreationQuestion) {
    return undefined;
  }
  const serverHit = pickBestHitByPredicate(hits, (_hit, normalizedHeadingPath, normalizedBody) => {
    return (
      (normalizedHeadingPath.includes("creating community channels") ||
        normalizedHeadingPath.includes("creating community channel") ||
        normalizedHeadingPath.includes("creating channel")) &&
      normalizedBody.includes("server api")
    );
  });
  if (!serverHit) {
    return {
      line:
        language === "en"
          ? "Community channels and subchannels are created via Server API."
          : "Community channel 和 subchannel 需要通过 Server API 创建。",
    };
  }
  return {
    line:
      language === "en"
        ? `Community channels and subchannels are created via Server API, not by a client-side SDK create call.${inlineCitation(serverHit)}`
        : `Community channel 和 subchannel 通过 Server API 创建，而不是由客户端 SDK 直接发起创建。${inlineCitation(serverHit)}`,
    hit: serverHit,
  };
}

function isGenericProceduralReferenceQuestion(question: string): boolean {
  const normalizedQuestion = normalizeAnswerText(question);
  return !(
    normalizedQuestion.includes("chat") ||
    normalizedQuestion.includes("channel") ||
    normalizedQuestion.includes("message") ||
    normalizedQuestion.includes("community") ||
    normalizedQuestion.includes("webhook") ||
    normalizedQuestion.includes("connect") ||
    normalizedQuestion.includes("conversation") ||
    normalizedQuestion.includes("send ") ||
    normalizedQuestion.startsWith("send ")
  );
}

function isReleaseNotesQuestion(question: string): boolean {
  const normalizedQuestion = normalizeAnswerText(question);
  return (
    normalizedQuestion.includes("release notes") ||
    normalizedQuestion.includes("version history") ||
    normalizedQuestion.includes("what was added")
  );
}

function isPushClickQuestion(question: string): boolean {
  const normalizedQuestion = normalizeAnswerText(question);
  return (
    normalizedQuestion.includes("push notification") &&
    (normalizedQuestion.includes("click") ||
      normalizedQuestion.includes("open") ||
      normalizedQuestion.includes("conversation"))
  );
}

function filterQuestionScopedGuideHits(question: string, hits: AnalyzedHit[]): AnalyzedHit[] {
  const normalizedQuestion = normalizeAnswerText(question);
  let scopedHits = hits;

  const explicitProduct = normalizedQuestion.includes("callsdk")
    ? "callsdk"
    : normalizedQuestion.includes("chatsdk")
      ? "chatsdk"
      : undefined;
  if (explicitProduct) {
    const productScoped = scopedHits.filter((hit) => {
      const normalized = normalizeAnswerText([hit.path, hit.heading ?? "", hit.text].join("\n"));
      if (explicitProduct === "callsdk") {
        return !normalized.includes("chatsdk");
      }
      return !normalized.includes("callsdk");
    });
    if (productScoped.length > 0) {
      scopedHits = productScoped;
    }
  }

  const explicitPlatform = normalizedQuestion.includes("android")
    ? "android"
    : normalizedQuestion.includes("ios")
      ? "ios"
      : normalizedQuestion.includes("web")
        ? "web"
        : normalizedQuestion.includes("flutter")
          ? "flutter"
          : undefined;
  if (explicitPlatform) {
    const conflictingTerms =
      explicitPlatform === "ios"
        ? ["android specific", "android-specific object"]
        : explicitPlatform === "android"
          ? ["ios specific", "ios-specific object"]
          : explicitPlatform === "web"
            ? ["android specific", "ios specific", "flutter"]
            : ["android specific", "ios specific", "web"];
    const platformScoped = scopedHits.filter((hit) => {
      const normalized = normalizeAnswerText([hit.heading ?? "", hit.text].join("\n"));
      return !conflictingTerms.some((term) => normalized.includes(term));
    });
    if (platformScoped.length > 0) {
      scopedHits = platformScoped;
    }
  }

  if (isReleaseNotesQuestion(question)) {
    const releaseHits = scopedHits.filter((hit) => {
      const normalized = normalizeAnswerText([hit.path, hit.heading ?? "", hit.text].join("\n"));
      return (
        normalized.includes("release notes") ||
        normalized.includes("new features") ||
        normalized.includes("added") ||
        /^v?\d+\s+\d+\s+\d+/.test(normalized)
      );
    });
    if (releaseHits.length > 0) {
      scopedHits = releaseHits;
    }
  }

  if (isPushClickQuestion(question)) {
    const navigationHits = scopedHits.filter((hit) => {
      const normalized = normalizeAnswerText([hit.path, hit.heading ?? "", hit.text].join("\n"));
      return (
        hit.role === "navigation" ||
        normalized.includes("handle push notification click") ||
        normalized.includes("notification click") ||
        normalized.includes("channel page") ||
        normalized.includes("conversation page")
      );
    });
    if (navigationHits.length > 0) {
      scopedHits = navigationHits;
    }
  }

  if (
    normalizedQuestion.includes("targeted message") ||
    normalizedQuestion.includes("specific members")
  ) {
    const targetedHits = scopedHits.filter((hit) => {
      const normalized = normalizeAnswerText([hit.path, hit.heading ?? "", hit.text].join("\n"));
      return normalized.includes("targeted message") || normalized.includes("directeduserids");
    });
    if (targetedHits.length > 0) {
      scopedHits = targetedHits;
    }
  }

  return scopedHits;
}

function buildGenericProcedureLine(hit: AnalyzedHit, language: AnswerLanguage): string {
  const snippet = hit.snippet.trim();
  if (language === "en") {
    if (/^(run|use|call|open|configure|set|add|review)\b/i.test(snippet)) {
      return `${snippet}${inlineCitation(hit)}`;
    }
    return `${hit.heading ?? "Documented step"}: ${snippet}${inlineCitation(hit)}`;
  }
  if (/^(运行|使用|调用|打开|配置|设置|添加|查看)/u.test(snippet)) {
    return `${snippet}${inlineCitation(hit)}`;
  }
  return `${hit.heading ?? "文档步骤"}：${snippet}${inlineCitation(hit)}`;
}

function buildGenericProcedureAnswer(params: {
  question: string;
  language: AnswerLanguage;
  effectiveHits: AnalyzedHit[];
  noteLines?: string[];
}): GroundedAnswerResult {
  const citations = dedupeCitations(params.effectiveHits.slice(0, 4));
  const citedHits = params.effectiveHits.filter((hit) =>
    citations.some(
      (citation) =>
        citation.path === hit.path &&
        citation.startLine === hit.startLine &&
        citation.endLine === hit.endLine,
    ),
  );

  return {
    mode: "extractive",
    answer: [
      params.language === "en"
        ? "Use the documented steps below."
        : "下面是文档里可直接执行的步骤。",
      [
        sectionLabel(params.language, "steps"),
        ...citedHits.map(
          (hit, index) => `${index + 1}. ${buildGenericProcedureLine(hit, params.language)}`,
        ),
      ].join("\n"),
      params.noteLines && params.noteLines.length > 0
        ? [sectionLabel(params.language, "notes"), ...params.noteLines].join("\n")
        : "",
      renderSourcesAppendix(citations),
    ]
      .filter(Boolean)
      .join("\n\n"),
    summary: `guided answer from ${citations.length} documentation chunks`,
    citations,
    answerKind: "generic_guide",
    agentPolicy: "rewrite_allowed",
    answerSource: "generated",
    reviewStatus: "not_applicable",
  };
}

function detectGuideAnswerKind(params: {
  question: string;
  analysis: ReturnType<typeof analyzeHits>;
  channelHit?: AnalyzedHit;
  sendHit?: AnalyzedHit;
}): GuideAnswerKind {
  const normalizedQuestion = normalizeAnswerText(params.question);
  if (isSendMessageQuestion(params.question)) {
    return "send_message";
  }
  if (
    params.analysis.selectedChannelKind === "community" ||
    params.analysis.selectedChannelKind === "group" ||
    isChannelCreationQuestion(params.question)
  ) {
    return "channel_creation";
  }
  if (
    params.sendHit &&
    !isStartChatQuestion(params.question) &&
    !isChannelCreationQuestion(params.question) &&
    !normalizedQuestion.includes("direct channel")
  ) {
    return "send_message";
  }
  if (normalizedQuestion.includes("direct channel")) {
    return "start_chat";
  }
  if (isStartChatQuestion(params.question) || params.channelHit) {
    return "start_chat";
  }
  return "generic_guide";
}

function pickMessageParamsTerm(codeTerms: string[], subtype: MessageSubtype): string | undefined {
  const candidates =
    subtype === "text"
      ? ["SendTextMessageParams"]
      : subtype === "image"
        ? ["SendImageMessageParams", "SendMediaMessageParams"]
        : subtype === "file"
          ? ["SendFileMessageParams", "SendMediaMessageParams"]
          : subtype === "voice"
            ? ["SendVoiceMessageParams", "SendMediaMessageParams"]
            : subtype === "targeted"
              ? ["SendTextMessageParams"]
              : [
                  "SendTextMessageParams",
                  "SendImageMessageParams",
                  "SendFileMessageParams",
                  "SendVoiceMessageParams",
                  "SendMediaMessageParams",
                ];
  return candidates.find((candidate) => codeTerms.some((term) => term.includes(candidate)));
}

function canonicalizeApiTerm(term: string): string {
  return term
    .trim()
    .replace(/\(_:\)/g, "")
    .replace(/\(\)/g, "")
    .replace(/\s+/g, " ");
}

function collectApiTerms(params: {
  citedHits: AnalyzedHit[];
  answerKind: GuideAnswerKind;
  question: string;
}): string[] {
  const includeDirectChannel =
    params.answerKind === "start_chat" ||
    normalizeAnswerText(params.question).includes("direct channel");

  const seen = new Set<string>();
  const collected: string[] = [];
  for (const term of params.citedHits
    .flatMap((hit) => extractCodeTerms([hit.heading ?? "", hit.text].join("\n")))
    .map(canonicalizeApiTerm)) {
    const allowed =
      term.includes("sendMessage") ||
      term.includes("directedUserIds") ||
      term.includes("MessageParams") ||
      (term.includes("NCEngine") && params.answerKind !== "send_message") ||
      (term.includes("intent-filter") && params.answerKind !== "send_message") ||
      (term.includes("Channel") && includeDirectChannel);
    if (!allowed || seen.has(term)) {
      continue;
    }
    seen.add(term);
    collected.push(term);
  }
  return collected.slice(0, 6);
}

function findSpecializedCompanionHit(params: {
  hits: AnalyzedHit[];
  answerKind: GuideAnswerKind;
  selectedPlatform?: DocPlatform;
}): AnalyzedHit | undefined {
  return params.hits
    .filter((hit) => hit.docShape === "specialized_task")
    .filter((hit) => !params.selectedPlatform || hit.platform === params.selectedPlatform)
    .filter((hit) => {
      if (params.answerKind === "send_message") {
        return hit.role === "send_first_message";
      }
      if (params.answerKind === "channel_creation") {
        return hit.role !== "definition" && hit.role !== "server_irrelevant";
      }
      if (params.answerKind === "start_chat") {
        return hit.role === "start_chat" || hit.role === "send_first_message";
      }
      return true;
    })
    .toSorted((left, right) => right.score - left.score)[0];
}

function buildGuideAnswer(
  question: string,
  hits: DocSearchHit[],
  language: AnswerLanguage,
  options?: {
    allowClarificationOnly?: boolean;
    prependStepLines?: string[];
    prependStepHits?: AnalyzedHit[];
    appendNoteLines?: string[];
  },
): GroundedAnswerResult {
  const analysis = analyzeHits(question, hits);
  if (analysis.shouldClarifyChannelKind) {
    return buildChannelClarificationAnswer(question, analysis, language);
  }
  if (analysis.shouldClarifyPlatform && options?.allowClarificationOnly !== false) {
    return buildClarificationAnswer(question, analysis, language);
  }

  if (analysis.relevantHits.length === 0 && !isExplicitServerApiQuestion(question)) {
    return buildNoHitAnswer(question, language);
  }

  const effectiveHits =
    options?.allowClarificationOnly === false && analysis.shouldClarifyPlatform
      ? analysis.relevantHits
      : analysis.usedHits.length > 0
        ? analysis.usedHits
        : analysis.relevantHits;
  if (effectiveHits.length === 0) {
    return buildNoHitAnswer(question, language);
  }
  const scopedHits = filterQuestionScopedGuideHits(question, effectiveHits);
  const workingHits = scopedHits.length > 0 ? scopedHits : effectiveHits;

  if (isGenericProceduralReferenceQuestion(question)) {
    return buildGenericProcedureAnswer({
      question,
      language,
      effectiveHits: workingHits,
    });
  }
  if (isReleaseNotesQuestion(question) || isPushClickQuestion(question)) {
    return buildGenericProcedureAnswer({
      question,
      language,
      effectiveHits: workingHits.slice(0, 4),
    });
  }
  if (isEndActionQuestion(question)) {
    const endActionHits = workingHits.filter((hit) => isOperationalEndActionHit(hit));
    if (endActionHits.length > 0) {
      const clarifyingNote = buildEndActionClarifyingNote(question, endActionHits, language);
      return buildGenericProcedureAnswer({
        question,
        language,
        effectiveHits: endActionHits.slice(0, 4),
        noteLines: clarifyingNote ? [clarifyingNote] : undefined,
      });
    }
  }

  const normalizedQuestion = normalizeAnswerText(question);
  const isConnectionMetadataHit = (hit: AnalyzedHit | undefined): boolean => {
    if (!hit) {
      return false;
    }
    const normalizedHeadingPath = normalizeAnswerText([hit.path, hit.heading ?? ""].join("\n"));
    const normalizedBody = normalizeAnswerText(hit.text);
    return (
      normalizedHeadingPath.includes("status code") ||
      normalizedHeadingPath.includes("error code") ||
      normalizedHeadingPath.includes("monitor status") ||
      normalizedHeadingPath.includes("reconnection") ||
      normalizedBody.includes("status code") ||
      normalizedBody.includes("error code")
    );
  };

  const importHit = pickBestHitByPredicate(workingHits, (_hit, normalizedHeadingPath) =>
    normalizedHeadingPath.includes("import"),
  );
  const initializeHit = pickBestHitByPredicate(
    workingHits,
    (_hit, normalizedHeadingPath, normalizedBody) =>
      normalizedHeadingPath.includes("initialize") ||
      normalizedBody.includes("ncengine initialize"),
  );
  const setupHit = importHit ?? initializeHit ?? pickBestHit(workingHits, ["setup"]);
  const connectHit =
    pickBestHitByPredicate(
      workingHits,
      (_hit, normalizedHeadingPath, normalizedBody) =>
        !normalizedHeadingPath.includes("status code") &&
        !normalizedHeadingPath.includes("error code") &&
        !normalizedHeadingPath.includes("monitor status") &&
        !normalizedHeadingPath.includes("reconnection") &&
        !normalizedBody.includes("status code") &&
        !normalizedBody.includes("error code") &&
        (normalizedHeadingPath.includes("connect") ||
          normalizedHeadingPath.includes("connection") ||
          normalizedBody.includes("ncengine connect") ||
          normalizedBody.includes("connect the user")),
    ) ?? pickBestHit(workingHits, ["connect"]);
  const effectiveConnectHit = isConnectionMetadataHit(connectHit) ? undefined : connectHit;
  const navigationHit = pickBestHit(workingHits, ["navigation"]);
  const channelHit = pickBestHit(workingHits, ["start_chat", "platform"]);
  const preferredGenericSendHit =
    detectMessageSubtype(question) === "generic" &&
    (normalizedQuestion.includes("first message") || isSendMessageQuestion(question))
      ? pickBestHitByPredicate(
          workingHits,
          (_hit, normalizedHeadingPath) =>
            normalizedHeadingPath.includes("send a text message") ||
            normalizedHeadingPath.includes("send a regular message"),
        )
      : undefined;
  const specializedSendHit = pickBestSendHit(
    question,
    workingHits.filter((hit) => hit.docShape === "specialized_task"),
  );
  const sendHit =
    preferredGenericSendHit ??
    (normalizedQuestion.includes("first message") ||
    (isSendMessageQuestion(question) && !wantsEndToEndSdkFlow(question))
      ? (specializedSendHit ?? pickBestSendHit(question, workingHits))
      : pickBestSendHit(question, workingHits));
  const answerKind = detectGuideAnswerKind({
    question,
    analysis,
    channelHit,
    sendHit,
  });
  const messageSubtype =
    answerKind === "send_message" ? detectMessageSubtype(question, sendHit) : "generic";
  const includeEndToEndSections = answerKind === "generic_guide" || wantsEndToEndSdkFlow(question);
  const overviewHit = pickBestHit(workingHits, ["platform", "start_chat", "setup"]);
  const webhookGuide =
    normalizeAnswerText(question).includes("webhook") ||
    workingHits.some((hit) => isWebhookHit(hit));
  const webhookStepHits = webhookGuide
    ? workingHits.filter((hit) => {
        const normalizedHeadingPath = normalizeAnswerText([hit.path, hit.heading ?? ""].join("\n"));
        const normalizedBody = normalizeAnswerText(hit.text);
        return (
          isWebhookHit(hit) &&
          (normalizedHeadingPath.includes("/webhook/overview") ||
            normalizedHeadingPath.includes("set up webhook") ||
            normalizedHeadingPath.includes("setup webhook") ||
            normalizedHeadingPath.includes("signature") ||
            normalizedBody.includes("webhook url") ||
            normalizedBody.includes("callback url") ||
            normalizedBody.includes("signature"))
        );
      })
    : [];

  const needHits = webhookGuide
    ? []
    : answerKind === "send_message"
      ? includeEndToEndSections
        ? [importHit, initializeHit, effectiveConnectHit].filter((hit): hit is AnalyzedHit =>
            Boolean(hit),
          )
        : []
      : answerKind === "start_chat" || answerKind === "channel_creation"
        ? includeEndToEndSections
          ? [importHit, initializeHit, effectiveConnectHit].filter((hit): hit is AnalyzedHit =>
              Boolean(hit),
            )
          : []
        : [importHit, initializeHit, effectiveConnectHit, navigationHit, channelHit].filter(
            (hit): hit is AnalyzedHit => Boolean(hit),
          );
  const stepHits = webhookGuide
    ? webhookStepHits.length > 0
      ? webhookStepHits
      : workingHits.filter((hit) => isWebhookHit(hit)).slice(0, 3)
    : answerKind === "send_message"
      ? [sendHit].filter((hit): hit is AnalyzedHit => Boolean(hit))
      : answerKind === "start_chat" || answerKind === "channel_creation"
        ? [navigationHit, channelHit, sendHit].filter(
            (hit, index, all): hit is AnalyzedHit => Boolean(hit) && all.indexOf(hit) === index,
          )
        : [
            importHit,
            initializeHit,
            effectiveConnectHit,
            navigationHit,
            channelHit,
            sendHit,
          ].filter(
            (hit, index, all): hit is AnalyzedHit => Boolean(hit) && all.indexOf(hit) === index,
          );
  const autoSharedRule = buildCommunityCreationServerRule(question, workingHits, language);
  const prependStepLines = Array.from(
    new Set([
      ...(autoSharedRule ? [autoSharedRule.line] : []),
      ...(options?.prependStepLines ?? []),
    ]),
  );
  const prependStepHits = [
    ...(autoSharedRule?.hit ? [autoSharedRule.hit] : []),
    ...(options?.prependStepHits ?? []),
  ].filter((hit, index, all) => all.indexOf(hit) === index);
  const citedHits =
    stepHits.length > 0
      ? [...prependStepHits, ...stepHits]
      : [...prependStepHits, ...workingHits.slice(0, 4)];
  const primaryHit = stepHits[0] ?? overviewHit;
  const specializedCompanionHit =
    primaryHit?.docShape === "quickstart_step"
      ? findSpecializedCompanionHit({
          hits: workingHits,
          answerKind,
          selectedPlatform: analysis.selectedPlatform,
        })
      : undefined;
  const citedHitsWithCompanion =
    specializedCompanionHit && !citedHits.includes(specializedCompanionHit)
      ? [...citedHits, specializedCompanionHit]
      : citedHits;
  const citations = dedupeCitations(citedHitsWithCompanion);
  const apiTerms = collectApiTerms({
    citedHits: citedHitsWithCompanion,
    answerKind,
    question,
  });

  const noteLines: string[] = [];
  const isCommunityProvisioningFlow =
    analysis.selectedChannelKind === "community" &&
    (normalizedQuestion.includes("create") || normalizedQuestion.includes("get"));
  const sdkChatFlow =
    !webhookGuide &&
    !isCommunityProvisioningFlow &&
    (workingHits.some((hit) => normalizeAnswerText(hit.path).includes("chatsdk")) ||
      Boolean(channelHit) ||
      Boolean(sendHit) ||
      Boolean(connectHit));
  if (channelHit && sdkChatFlow && answerKind === "start_chat") {
    noteLines.push(
      language === "en"
        ? `- A direct channel is a one-to-one conversation whose channel ID is typically the target user ID.${inlineCitation(channelHit)}`
        : `- Direct channel 表示两个用户之间的一对一私聊，会话标识通常就是对方用户 ID。${inlineCitation(channelHit)}`,
    );
  }
  if (sdkChatFlow && includeEndToEndSections && !setupHit && !importHit && !initializeHit) {
    noteLines.push(
      language === "en"
        ? "- The retrieved docs do not cover SDK import or initialization."
        : "- 当前命中的文档没有覆盖完整的 SDK 导入或初始化步骤。",
    );
  }
  if (sdkChatFlow && includeEndToEndSections && !connectHit) {
    noteLines.push(
      language === "en"
        ? "- The retrieved docs do not cover token acquisition or connection establishment."
        : "- 当前命中的文档没有展开 token 获取或连接建立步骤。",
    );
  }
  if (sdkChatFlow && answerKind !== "send_message" && !sendHit) {
    noteLines.push(
      language === "en"
        ? "- The retrieved docs do not include a concrete send-message example."
        : "- 当前命中的文档没有给出明确的发消息示例。",
    );
  }
  if (primaryHit?.docShape === "quickstart_step") {
    noteLines.push(
      language === "en"
        ? `- This citation is a quickstart subsection, so it assumes the surrounding tutorial steps are already complete.${inlineCitation(primaryHit)}`
        : `- 当前引用的是 quickstart 子步骤，默认前面的教程步骤已经完成。${inlineCitation(primaryHit)}`,
    );
    if (specializedCompanionHit && specializedCompanionHit !== primaryHit) {
      noteLines.push(
        language === "en"
          ? `- For the task-focused API details, continue with ${specializedCompanionHit.heading ?? specializedCompanionHit.path}.${inlineCitation(specializedCompanionHit)}`
          : `- 如果你要看更完整的任务型 API 说明，可以继续参考 ${specializedCompanionHit.heading ?? specializedCompanionHit.path}。${inlineCitation(specializedCompanionHit)}`,
      );
    }
  }
  if (analysis.shouldClarifyPlatform && options?.allowClarificationOnly === false) {
    noteLines.push(buildPlatformClarificationNote(analysis, language));
  }
  if (options?.appendNoteLines?.length) {
    noteLines.push(...options.appendNoteLines);
  }

  const combinedStepLines = [
    ...prependStepLines,
    ...stepHits.map((hit) =>
      buildStepLine(hit, language, {
        answerKind,
        question,
      }),
    ),
  ];
  const selectedPlatform =
    analysis.shouldClarifyPlatform && options?.allowClarificationOnly === false
      ? undefined
      : analysis.selectedPlatform;

  return {
    mode: "extractive",
    answer: [
      buildGuideIntro({
        language,
        answerKind,
        platform: selectedPlatform,
        channelKind: analysis.selectedChannelKind,
        messageSubtype,
        primaryHit,
        overviewHit,
        setupHit,
        connectHit,
        channelHit,
        sendHit,
      }),
      needHits.length > 0
        ? [
            sectionLabel(language, "need"),
            ...needHits.map((hit) => stripListMarker(buildNeedLine(hit, language))),
          ].join("\n")
        : "",
      combinedStepLines.length > 0
        ? [
            sectionLabel(language, "steps"),
            ...combinedStepLines.map((line) => `- ${stripListMarker(line)}`),
          ].join("\n")
        : "",
      apiTerms.length > 0
        ? [sectionLabel(language, "apis"), ...apiTerms.map((term) => `\`${term}\``)].join("\n")
        : "",
      noteLines.length > 0
        ? [sectionLabel(language, "notes"), ...noteLines.map(stripListMarker)].join("\n")
        : "",
      renderSourcesAppendix(citations),
    ]
      .filter(Boolean)
      .join("\n\n"),
    summary:
      analysis.shouldClarifyPlatform && options?.allowClarificationOnly === false
        ? "platform clarification required"
        : `guided answer from ${citations.length} documentation chunks`,
    citations,
    answerKind,
    agentPolicy:
      analysis.shouldClarifyPlatform && options?.allowClarificationOnly === false
        ? "bypass_agent"
        : "rewrite_allowed",
    answerSource: "generated",
    reviewStatus: "not_applicable",
    pendingClarificationQuestion:
      analysis.shouldClarifyPlatform && options?.allowClarificationOnly === false
        ? question
        : undefined,
    clarificationHits:
      analysis.shouldClarifyPlatform && options?.allowClarificationOnly === false
        ? effectiveHits
        : undefined,
  };
}

function buildMixedAnswer(
  question: string,
  hits: DocSearchHit[],
  language: AnswerLanguage,
): GroundedAnswerResult {
  const plan = planDocQuestion(question);
  const conceptQuestion = pickPlanStepQuestion(plan, "concept", question);
  const proceduralQuestion = pickPlanStepQuestion(plan, "procedural", question);
  const conceptHits = getBucketHits(hits, "concept");
  const proceduralHits = getBucketHits(hits, "procedural");
  const proceduralAnalyzedHits = analyzeHits(
    proceduralQuestion,
    proceduralHits.length > 0 ? proceduralHits : hits,
  ).relevantHits;
  const sharedRule = buildCommunityCreationServerRule(
    proceduralQuestion,
    proceduralAnalyzedHits,
    language,
  );

  const definition = buildConceptAnswer(
    conceptQuestion,
    conceptHits.length > 0 ? conceptHits : hits,
    language,
  );
  const procedural = buildGuideAnswer(
    proceduralQuestion,
    proceduralHits.length > 0 ? proceduralHits : hits,
    language,
    {
      allowClarificationOnly: false,
      prependStepLines: sharedRule ? [sharedRule.line] : [],
      prependStepHits: sharedRule?.hit ? [sharedRule.hit] : [],
    },
  );

  if (definition.summary === "no relevant documentation found") {
    return procedural;
  }

  const combinedCitations = dedupeCitations([
    ...definition.citations.map((citation) => ({
      ...citation,
      score: 0,
      text: citation.snippet,
    })),
    ...procedural.citations.map((citation) => ({
      ...citation,
      score: 0,
      text: citation.snippet,
    })),
  ]);

  const definitionBlock = definition.answer
    .split("\n\n")
    .filter((section) => !section.startsWith("Sources:"))
    .join("\n\n");
  const stepsBlock = procedural.answer
    .split("\n\n")
    .filter((section) => !section.startsWith("Sources:"))
    .join("\n\n");

  return {
    mode: "extractive",
    answer: [definitionBlock, stepsBlock, renderSourcesAppendix(combinedCitations)]
      .filter(Boolean)
      .join("\n\n"),
    summary:
      procedural.summary === "platform clarification required"
        ? procedural.summary
        : "mixed answer from documentation chunks",
    citations: combinedCitations,
    answerKind: "generic_guide",
    agentPolicy: procedural.agentPolicy,
    answerSource: "generated",
    reviewStatus: "not_applicable",
    pendingClarificationQuestion: procedural.pendingClarificationQuestion,
    clarificationHits: procedural.clarificationHits,
  };
}

function buildGroundedAnswer(
  question: string,
  hits: DocSearchHit[],
  languageOverride?: AnswerLanguage,
): GroundedAnswerResult {
  const language = languageOverride ?? detectAnswerLanguage(question, hits);
  if (hits.length === 0) {
    return buildNoHitAnswer(question, language);
  }

  const plan = planDocQuestion(question);
  if (plan.kind === "mixed") {
    return buildMixedAnswer(question, hits, language);
  }
  if (plan.kind === "concept") {
    return buildConceptAnswer(question, hits, language);
  }

  return buildGuideAnswer(question, hits, language);
}

function buildAgentPrompt(
  question: string,
  groundedAnswer: string,
  hits: DocSearchHit[],
  evidence?: EvidencePack,
): string {
  const renderedEvidence =
    evidence ??
    buildEvidencePack({
      state: buildQuestionState(question),
      hits,
    });
  const state = renderedEvidence.questionState ?? buildQuestionState(question);
  const language = detectAnswerLanguage(question, hits);
  const plan = buildAnswerPlan({
    question,
    state,
    evidence: renderedEvidence,
  });
  return buildAgentPromptFromPlan({
    question,
    state,
    language,
    plan,
    evidence: renderedEvidence,
    draftAnswer: groundedAnswer,
  });
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

function isLikelyPromptEcho(text: string): boolean {
  const normalized = text.toLowerCase();
  if (normalized.includes("你刚才说的是：")) {
    return true;
  }
  let matches = 0;
  for (const marker of PROMPT_ECHO_MARKERS) {
    if (normalized.includes(marker)) {
      matches += 1;
    }
  }
  return matches >= 3;
}

function extractAcceptedAgentAnswer(reply: string | undefined): string {
  const raw = (reply ?? "").trim();
  if (!raw || isLikelyPromptEcho(raw)) {
    return "";
  }
  const sliced = sliceBetweenSentinels(raw).trim();
  if (sliced && !isLikelyPromptEcho(sliced)) {
    return sliced;
  }
  return raw;
}

function buildExtractiveAnswerSurface(note?: string): DocAnswerSurface {
  return {
    kind: "extractive",
    trust: "not_applicable",
    outputContract: "grounded_extractive",
    note,
  };
}

function buildLearningAgentSurface(params: {
  provider?: string;
  model?: string;
  note?: string;
}): DocAnswerSurface {
  const provider = params.provider?.toLowerCase();
  const model = params.model?.toLowerCase();
  const isMockSurface = provider === "mock" || Boolean(model?.startsWith("learning-"));
  return {
    kind: isMockSurface ? "learning_mock" : "learning_agent",
    trust: isMockSurface ? "non_authoritative" : "authoritative",
    outputContract: "sentinel_prompt",
    note: params.note,
  };
}

export async function buildDocAnswer(params: {
  runId: string;
  question: string;
  language?: AnswerLanguage;
  mode: DocAssistantMode;
  hits: DocSearchHit[];
  evidence?: EvidencePack;
  dataDir?: string;
  backend?: "embedded" | "cli";
  provider?: string;
  model?: string;
  openAICompatible?: OpenAICompatibleConfig;
  onDelta?: (data: { text: string; delta: string }) => void;
}): Promise<DocAnswerResult> {
  // `question-execution.ts` passes raw retrieval hits here. We first synthesize a grounded local
  // answer, then optionally rewrite it through the learning agent / OpenAI-compatible backend
  // using the same evidence pack so the final surface stays traceable.
  let emittedDelta = false;
  const emitDelta = (data: { text: string; delta: string }) => {
    emittedDelta = true;
    params.onDelta?.(data);
  };
  const evidenceHits: DocSearchHit[] =
    params.evidence?.groups.flatMap((group) =>
      group.citations.map((citation) => ({
        ...citation,
        score: group.score,
        text: citation.snippet,
        retrievalBucket:
          group.purpose === "definition" || group.purpose === "overview" ? "concept" : "procedural",
      })),
    ) ?? params.hits;
  const renderedEvidence =
    params.evidence ??
    buildEvidencePack({
      state: buildQuestionState(params.question),
      hits: evidenceHits,
    });
  const state = renderedEvidence.questionState ?? buildQuestionState(params.question);
  const answerPlan = buildAnswerPlan({
    question: params.question,
    state,
    evidence: renderedEvidence,
  });
  const grounded = buildGroundedAnswer(params.question, evidenceHits, params.language);
  if (params.mode === "extractive") {
    return {
      ...grounded,
      answerSurface: buildExtractiveAnswerSurface(),
      trace: renderedEvidence
        ? {
            answerPlan,
            evidence: {
              groupCount: renderedEvidence.groups.length,
              warnings: renderedEvidence.warnings,
              trimEvents: renderedEvidence.trimEvents,
            },
          }
        : undefined,
    };
  }
  if (grounded.agentPolicy === "bypass_agent") {
    return {
      ...grounded,
      mode: "agent",
      answerSurface: buildExtractiveAnswerSurface("agent_bypassed_for_grounded_answer"),
    };
  }
  if (
    params.openAICompatible &&
    (!params.provider || params.provider === "openai" || params.provider === "openai-compatible")
  ) {
    try {
      const remote = await answerWithOpenAICompatible({
        config: {
          ...params.openAICompatible,
          model: params.model ?? params.openAICompatible.model,
        },
        question: params.question,
        hits: params.hits,
        prompt: buildAgentPrompt(params.question, grounded.answer, evidenceHits, renderedEvidence),
        citations: grounded.citations,
        onDelta: params.onDelta,
      });
      return {
        ...grounded,
        mode: "agent",
        answer: remote.answer,
        summary: `answered with ${remote.selectedProvider}/${remote.selectedModel}`,
        selectedProvider: remote.selectedProvider,
        selectedModel: remote.selectedModel,
        answerSurface: {
          kind: "openai_compatible",
          trust: "authoritative",
          outputContract: "plain_text",
        },
      };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("prompt scaffolding")) {
        throw error;
      }
      return {
        ...grounded,
        mode: "agent",
        answerSurface: {
          kind: "openai_compatible",
          trust: "authoritative",
          outputContract: "plain_text",
          note: "rejected_prompt_scaffolding_output",
        },
      };
    }
  }

  const prompt = buildAgentPrompt(params.question, grounded.answer, evidenceHits, renderedEvidence);
  const eagerDelta = grounded.answer.slice(0, Math.min(80, grounded.answer.length));
  if (eagerDelta) {
    emitDelta({
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
      if (isLikelyPromptEcho(event.text)) {
        return;
      }
      const visible = sliceBetweenSentinels(event.text);
      if (!visible || visible === lastVisible) {
        return;
      }
      const delta = visible.slice(lastVisible.length);
      lastVisible = visible;
      emitDelta({
        text: visible,
        delta,
      });
    },
  });
  const terminal = await agentRun.completion;
  const acceptedAnswer = extractAcceptedAgentAnswer(terminal.reply);
  const surfaceNote = acceptedAnswer ? undefined : "rejected_prompt_scaffolding_output";
  const terminalAnswer = acceptedAnswer || lastVisible || grounded.answer;
  if (terminalAnswer && !emittedDelta) {
    emitDelta({
      text: terminalAnswer,
      delta: terminalAnswer,
    });
  }
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
    answerSurface: buildLearningAgentSurface({
      provider: terminal.selectedProvider ?? params.provider,
      model: terminal.selectedModel ?? params.model,
      note: surfaceNote,
    }),
    trace: renderedEvidence
      ? {
          answerPlan,
          evidence: {
            groupCount: renderedEvidence.groups.length,
            warnings: renderedEvidence.warnings,
            trimEvents: renderedEvidence.trimEvents,
          },
        }
      : undefined,
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
    answerSurface: params.result.answerSurface,
    validation: params.result.validation,
    trace: params.result.trace,
  };
}
