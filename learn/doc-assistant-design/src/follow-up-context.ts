import path from "node:path";
import { isNonCacheableSummary } from "./answer-cache-policy.js";
import type { ClarificationKind } from "./clarification-policy.js";
import { detectDocShape, type DocSearchDocShape } from "./doc-shape.js";
import { readJsonSafe, writeJsonAtomic } from "./persistence.js";
import type { DocSearchHit } from "./protocol/index.js";
import {
  detectPreferredDocShape,
  detectProceduralTaskKind,
  type DocPreferredDocShape,
  type DocProceduralTaskKind,
} from "./question-planning.js";
import {
  buildQuestionState,
  mergeQuestionState,
  type QuestionApiLayer,
  type QuestionChannelKind,
  type QuestionState,
} from "./question-state.js";
import { resolveDocAssistantDataDir } from "./user-store.js";

export type DocFollowUpPlatform = "android" | "ios" | "web" | "flutter";

export type StoredClarificationContext = {
  sessionId: string;
  runId: string;
  originalQuestion: string;
  pendingQuestion?: string;
  normalizedQuestion?: string;
  clarificationKind?: ClarificationKind;
  questionState?: Pick<
    QuestionState,
    "intent" | "taskKind" | "platform" | "channelKind" | "apiLayer" | "referent" | "ambiguity"
  >;
  pendingState?: Partial<QuestionState>;
  taskKind?: DocProceduralTaskKind;
  preferredDocShape?: DocPreferredDocShape;
  originalTopHitShapes?: DocSearchDocShape[];
  candidatePlatforms: DocFollowUpPlatform[];
  hits: DocSearchHit[];
  createdAt: number;
};

type FollowUpContextStore = Record<string, StoredClarificationContext>;

const PLATFORM_PATTERNS: Record<DocFollowUpPlatform, RegExp[]> = {
  android: [/\bandroid\b/gi, /安卓(?:端)?/g],
  ios: [/\bios\b/gi, /\biphone\b/gi, /\bipad\b/gi, /苹果(?:端)?/g],
  web: [/\bweb\b/gi, /\bjavascript\b/gi, /\bjs\b/gi, /网页/g, /浏览器/g, /h5/g],
  flutter: [/\bflutter\b/gi, /\bdart\b/gi, /flutter端/g],
};

const CHANNEL_KIND_PATTERNS: Record<QuestionChannelKind, RegExp[]> = {
  direct: [/\bdirect(?:\s+channel)?\b/gi, /\bone to one\b/gi, /单聊/g, /私聊/g],
  group: [/\bgroup(?:\s+channel)?\b/gi, /群聊/g, /群组/g],
  community: [/\bcommunity(?:\s+channel)?\b/gi, /\bsubchannel\b/gi, /社区/g, /子频道/g],
  open: [/\bopen(?:\s+channel)?\b/gi, /开放频道/g],
};

const API_LAYER_PATTERNS: Record<QuestionApiLayer, RegExp[]> = {
  client: [/\bclient(?:\s+sdk)?\b/gi, /\bclient side\b/gi, /\bsdk\b/gi, /客户端/g],
  server: [/\bserver(?:\s+api)?\b/gi, /\brest api\b/gi, /服务端/g, /服务端 api/g],
};

const FOLLOW_UP_FILLER_PATTERNS = [
  /我要(?:找|看)?/g,
  /我想(?:找|看)?/g,
  /给我看/g,
  /那/g,
  /这个/g,
  /版本/g,
  /平台/g,
  /的/g,
  /端/g,
  /呢/g,
  /吧/g,
  /呀/g,
  /\bshow\b/gi,
  /\bme\b/gi,
  /\bfor\b/gi,
  /\bthe\b/gi,
  /\bone\b/gi,
  /\bversion\b/gi,
  /\bplease\b/gi,
];

const TECHNICAL_SIGNAL_PATTERNS = [
  /\bsdk\b/i,
  /\bapi\b/i,
  /\bchat\b/i,
  /\bcall\b/i,
  /\bmessage\b/i,
  /\bconversation\b/i,
  /\bdirect\b/i,
  /\bchannel\b/i,
  /\bconnect\b/i,
  /\bconfigure\b/i,
  /\bconfig\b/i,
  /\binit\b/i,
  /\binitialize\b/i,
  /\binstall\b/i,
  /\bstart\b/i,
  /\bsend\b/i,
  /\bcreate\b/i,
  /如何/,
  /怎么/,
  /初始化/,
  /连接/,
  /配置/,
  /发送/,
  /单聊/,
  /群聊/,
  /消息/,
  /通话/,
  /接入/,
];

function getFollowUpContextPath(dataDir?: string): string {
  return path.join(resolveDocAssistantDataDir(dataDir), "follow-up-context.json");
}

async function loadFollowUpContextStore(dataDir?: string): Promise<FollowUpContextStore> {
  return await readJsonSafe<FollowUpContextStore>(getFollowUpContextPath(dataDir), {});
}

async function saveFollowUpContextStore(
  store: FollowUpContextStore,
  dataDir?: string,
): Promise<void> {
  await writeJsonAtomic(getFollowUpContextPath(dataDir), store);
}

function isStoredClarificationContextValid(
  entry: StoredClarificationContext | null | undefined,
): boolean {
  if (!entry) {
    return false;
  }
  if (detectClarificationFollowUpQuestion(entry.originalQuestion)) {
    return false;
  }
  if (entry.pendingQuestion && detectClarificationFollowUpQuestion(entry.pendingQuestion)) {
    return false;
  }
  if (entry.hits.length === 0) {
    return false;
  }
  if (entry.clarificationKind === "platform" && entry.candidatePlatforms.length === 0) {
    return false;
  }
  return true;
}

function normalizeFollowUpText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[?!.:,;，。！？、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeClarificationQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[?!.:,;，。！？、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripPatterns(text: string, patterns: RegExp[]): string {
  let remainder = text;
  for (const pattern of patterns) {
    remainder = remainder.replace(new RegExp(pattern.source, pattern.flags), " ");
  }
  for (const filler of FOLLOW_UP_FILLER_PATTERNS) {
    remainder = remainder.replace(filler, " ");
  }
  return remainder.replace(/\s+/g, " ").trim();
}

function isEmptyFollowUpRemainder(text: string, patterns: RegExp[]): boolean {
  return stripPatterns(text, patterns).length === 0;
}

export function detectFollowUpPlatform(value: string): DocFollowUpPlatform | undefined {
  const normalized = normalizeFollowUpText(value);
  const matched = Object.entries(PLATFORM_PATTERNS)
    .filter(([, patterns]) =>
      patterns.some((pattern) => new RegExp(pattern.source, pattern.flags).test(normalized)),
    )
    .map(([platform]) => platform as DocFollowUpPlatform);
  return matched.length === 1 ? matched[0] : undefined;
}

function detectFollowUpChannelKind(value: string): QuestionChannelKind | undefined {
  const normalized = normalizeFollowUpText(value);
  const matched = Object.entries(CHANNEL_KIND_PATTERNS)
    .filter(([, patterns]) =>
      patterns.some((pattern) => new RegExp(pattern.source, pattern.flags).test(normalized)),
    )
    .map(([kind]) => kind as QuestionChannelKind);
  return matched.length === 1 ? matched[0] : undefined;
}

function detectFollowUpApiLayer(value: string): QuestionApiLayer | undefined {
  const normalized = normalizeFollowUpText(value);
  const matched = Object.entries(API_LAYER_PATTERNS)
    .filter(([, patterns]) =>
      patterns.some((pattern) => new RegExp(pattern.source, pattern.flags).test(normalized)),
    )
    .map(([kind]) => kind as QuestionApiLayer);
  return matched.length === 1 ? matched[0] : undefined;
}

export function extractQuestionStatePatchFromFollowUp(
  question: string,
): Partial<QuestionState> | null {
  const followUp = detectClarificationFollowUpQuestion(question);
  if (!followUp) {
    return null;
  }
  if (followUp.platform) {
    return { platform: followUp.platform };
  }
  if (followUp.channelKind) {
    return { channelKind: followUp.channelKind };
  }
  if (followUp.apiLayer) {
    return { apiLayer: followUp.apiLayer };
  }
  return null;
}

export function mergeStoredStateWithFollowUp(
  base: QuestionState,
  patch: Partial<QuestionState>,
): QuestionState {
  return mergeQuestionState(base, patch);
}

export function detectClarificationFollowUpQuestion(question: string): {
  platform?: DocFollowUpPlatform;
  channelKind?: QuestionChannelKind;
  apiLayer?: QuestionApiLayer;
} | null {
  const normalized = normalizeFollowUpText(question);
  if (!normalized || normalized.length > 60) {
    return null;
  }

  const platform = detectFollowUpPlatform(normalized);
  if (platform && isEmptyFollowUpRemainder(normalized, Object.values(PLATFORM_PATTERNS).flat())) {
    return { platform };
  }

  const channelKind = detectFollowUpChannelKind(normalized);
  if (
    channelKind &&
    isEmptyFollowUpRemainder(normalized, Object.values(CHANNEL_KIND_PATTERNS).flat())
  ) {
    return { channelKind };
  }

  const apiLayer = detectFollowUpApiLayer(normalized);
  if (apiLayer && isEmptyFollowUpRemainder(normalized, Object.values(API_LAYER_PATTERNS).flat())) {
    return { apiLayer };
  }

  if (TECHNICAL_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }

  return null;
}

export function isStoredClarificationFollowUpAllowed(
  context: Pick<StoredClarificationContext, "clarificationKind" | "candidatePlatforms">,
  followUp: NonNullable<ReturnType<typeof detectClarificationFollowUpQuestion>>,
): boolean {
  if (context.clarificationKind === "platform") {
    return Boolean(followUp.platform && context.candidatePlatforms.includes(followUp.platform));
  }
  if (context.clarificationKind === "channel_kind") {
    return Boolean(followUp.channelKind);
  }
  if (context.clarificationKind === "api_layer") {
    return Boolean(followUp.apiLayer);
  }
  return false;
}

export function detectPlatformFromHit(hit: DocSearchHit): DocFollowUpPlatform | undefined {
  return (
    detectFollowUpPlatform(hit.path) ??
    detectFollowUpPlatform(hit.heading ?? "") ??
    detectFollowUpPlatform(hit.text)
  );
}

export function rewriteClarificationQuestion(
  originalQuestion: string,
  platform: DocFollowUpPlatform,
): string {
  const platformLabel =
    platform === "ios"
      ? "iOS"
      : platform === "web"
        ? "Web"
        : platform === "flutter"
          ? "Flutter"
          : "Android";
  const trimmed = originalQuestion.trim().replace(/[?!.。！？]+$/u, "");
  const asciiCount = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  const cjkCount = (trimmed.match(/[\u4e00-\u9fff]/g) ?? []).length;

  if (asciiCount >= cjkCount) {
    if (/\bon\s+(android|ios|web|flutter)\b/i.test(trimmed)) {
      return trimmed.replace(/\bon\s+(android|ios|web|flutter)\b/i, `on ${platformLabel}`) + "?";
    }
    return `${trimmed} on ${platformLabel}?`;
  }

  return `${platformLabel} ${trimmed}`;
}

export function selectPlatformHits(
  hits: DocSearchHit[],
  platform: DocFollowUpPlatform,
): DocSearchHit[] {
  return hits.filter((hit) => detectPlatformFromHit(hit) === platform);
}

export function extractClarificationPlatforms(hits: DocSearchHit[]): DocFollowUpPlatform[] {
  const platforms = hits
    .map((hit) => detectPlatformFromHit(hit))
    .filter((platform): platform is DocFollowUpPlatform => Boolean(platform));
  return Array.from(new Set(platforms));
}

export function shouldReuseClarificationHits(
  context:
    | Pick<
        StoredClarificationContext,
        "hits" | "taskKind" | "preferredDocShape" | "originalTopHitShapes"
      >
    | DocSearchHit[],
  platform: DocFollowUpPlatform,
): boolean {
  const hits = Array.isArray(context) ? context : context.hits;
  const selectedHits = selectPlatformHits(hits, platform);
  if (selectedHits.length < 2) {
    return false;
  }

  const taskKind = Array.isArray(context) ? "generic" : (context.taskKind ?? "generic");
  const preferredDocShape = Array.isArray(context)
    ? "specialized_task"
    : (context.preferredDocShape ?? "specialized_task");
  const topSelectedShapes = selectedHits
    .slice(0, 3)
    .map((hit) => hit.docShape ?? detectDocShape(hit));
  const quickstartCount = topSelectedShapes.filter((shape) => shape === "quickstart_step").length;
  const specializedCount = topSelectedShapes.filter((shape) => shape === "specialized_task").length;
  const topShape = topSelectedShapes[0];

  if (
    preferredDocShape === "specialized_task" &&
    (taskKind === "send_message" ||
      taskKind === "first_message" ||
      taskKind === "channel_creation") &&
    topShape === "quickstart_step"
  ) {
    return false;
  }

  if (
    (taskKind === "send_message" || taskKind === "first_message") &&
    quickstartCount > 0 &&
    quickstartCount >= specializedCount
  ) {
    return false;
  }

  return true;
}

export async function getStoredClarificationContext(
  sessionId: string,
  dataDir?: string,
): Promise<StoredClarificationContext | null> {
  const store = await loadFollowUpContextStore(dataDir);
  const entry = store[sessionId] ?? null;
  if (isStoredClarificationContextValid(entry)) {
    return entry;
  }
  if (entry) {
    delete store[sessionId];
    await saveFollowUpContextStore(store, dataDir);
  }
  return null;
}

export async function clearStoredClarificationContext(
  sessionId: string,
  dataDir?: string,
): Promise<void> {
  const store = await loadFollowUpContextStore(dataDir);
  if (!store[sessionId]) {
    return;
  }
  delete store[sessionId];
  await saveFollowUpContextStore(store, dataDir);
}

export async function persistClarificationContext(params: {
  sessionId: string;
  runId: string;
  originalQuestion: string;
  pendingQuestion?: string;
  clarificationKind?: ClarificationKind;
  pendingState?: Partial<QuestionState>;
  hits: DocSearchHit[];
  dataDir?: string;
}): Promise<StoredClarificationContext> {
  const store = await loadFollowUpContextStore(params.dataDir);
  const questionState = buildQuestionState(params.pendingQuestion ?? params.originalQuestion);
  const entry: StoredClarificationContext = {
    sessionId: params.sessionId,
    runId: params.runId,
    originalQuestion: params.originalQuestion,
    pendingQuestion: params.pendingQuestion,
    normalizedQuestion: normalizeClarificationQuestion(
      params.pendingQuestion ?? params.originalQuestion,
    ),
    clarificationKind: params.clarificationKind,
    questionState: {
      intent: questionState.intent,
      taskKind: questionState.taskKind,
      platform: questionState.platform,
      channelKind: questionState.channelKind,
      apiLayer: questionState.apiLayer,
      referent: questionState.referent,
      ambiguity: questionState.ambiguity,
    },
    pendingState: params.pendingState,
    taskKind: detectProceduralTaskKind(params.pendingQuestion ?? params.originalQuestion),
    preferredDocShape: detectPreferredDocShape(params.pendingQuestion ?? params.originalQuestion),
    originalTopHitShapes: params.hits.slice(0, 3).map((hit) => hit.docShape ?? detectDocShape(hit)),
    candidatePlatforms: extractClarificationPlatforms(params.hits),
    hits: params.hits,
    createdAt: Date.now(),
  };
  store[params.sessionId] = entry;
  await saveFollowUpContextStore(store, params.dataDir);
  return entry;
}

export async function updateClarificationStateAfterAnswer(params: {
  sessionId?: string;
  runId: string;
  question: string;
  hits: DocSearchHit[];
  summary: string;
  pendingQuestion?: string;
  clarificationKind?: ClarificationKind;
  pendingState?: Partial<QuestionState>;
  clarificationHits?: DocSearchHit[];
  route?: "greeting" | "memory" | "search";
  dataDir?: string;
}): Promise<void> {
  if (!params.sessionId) {
    return;
  }
  const looksLikeFollowUp = Boolean(detectClarificationFollowUpQuestion(params.question));
  const clarificationKind =
    params.clarificationKind ??
    (params.summary === "platform clarification required"
      ? "platform"
      : params.summary === "channel clarification required"
        ? "channel_kind"
        : params.summary === "api layer clarification required"
          ? "api_layer"
          : undefined);
  if (clarificationKind) {
    const pendingQuestion = params.pendingQuestion ?? params.question;
    const clarificationHits = params.clarificationHits ?? params.hits;
    const questionState = buildQuestionState(pendingQuestion);
    const storedOriginalQuestion =
      looksLikeFollowUp && pendingQuestion ? pendingQuestion : params.question;
    const entry: StoredClarificationContext = {
      sessionId: params.sessionId,
      runId: params.runId,
      originalQuestion: storedOriginalQuestion,
      pendingQuestion,
      normalizedQuestion: normalizeClarificationQuestion(pendingQuestion),
      clarificationKind,
      questionState: {
        intent: questionState.intent,
        taskKind: questionState.taskKind,
        platform: questionState.platform,
        channelKind: questionState.channelKind,
        apiLayer: questionState.apiLayer,
        referent: questionState.referent,
        ambiguity: questionState.ambiguity,
      },
      pendingState: params.pendingState,
      taskKind: detectProceduralTaskKind(pendingQuestion),
      preferredDocShape: detectPreferredDocShape(pendingQuestion),
      originalTopHitShapes: clarificationHits
        .slice(0, 3)
        .map((hit) => hit.docShape ?? detectDocShape(hit)),
      candidatePlatforms: extractClarificationPlatforms(clarificationHits),
      hits: clarificationHits,
      createdAt: Date.now(),
    };
    if (params.route !== "search" || !isStoredClarificationContextValid(entry)) {
      return;
    }
    await persistClarificationContext({
      sessionId: params.sessionId,
      runId: params.runId,
      originalQuestion: storedOriginalQuestion,
      pendingQuestion,
      clarificationKind,
      pendingState: params.pendingState,
      hits: clarificationHits,
      dataDir: params.dataDir,
    });
    return;
  }
  if (looksLikeFollowUp && (params.route === "memory" || isNonCacheableSummary(params.summary))) {
    return;
  }
  await clearStoredClarificationContext(params.sessionId, params.dataDir);
}
