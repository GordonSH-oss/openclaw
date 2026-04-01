import fs from "node:fs/promises";
import path from "node:path";
import { isNonCacheableSummary } from "./answer-cache-policy.js";
import type { DocSearchHit } from "./protocol/index.js";
import { resolveDocAssistantDataDir } from "./user-store.js";

export type DocFollowUpPlatform = "android" | "ios" | "web" | "flutter";

export type StoredClarificationContext = {
  sessionId: string;
  runId: string;
  originalQuestion: string;
  pendingQuestion?: string;
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
  try {
    const raw = await fs.readFile(getFollowUpContextPath(dataDir), "utf-8");
    return JSON.parse(raw) as FollowUpContextStore;
  } catch {
    return {};
  }
}

async function saveFollowUpContextStore(
  store: FollowUpContextStore,
  dataDir?: string,
): Promise<void> {
  const root = resolveDocAssistantDataDir(dataDir);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(getFollowUpContextPath(dataDir), JSON.stringify(store, null, 2), "utf-8");
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
  if (entry.candidatePlatforms.length === 0) {
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

export function detectFollowUpPlatform(value: string): DocFollowUpPlatform | undefined {
  const normalized = normalizeFollowUpText(value);
  const matched = Object.entries(PLATFORM_PATTERNS)
    .filter(([, patterns]) =>
      patterns.some((pattern) => new RegExp(pattern.source, pattern.flags).test(normalized)),
    )
    .map(([platform]) => platform as DocFollowUpPlatform);
  return matched.length === 1 ? matched[0] : undefined;
}

export function detectClarificationFollowUpQuestion(
  question: string,
): { platform: DocFollowUpPlatform } | null {
  const normalized = normalizeFollowUpText(question);
  if (!normalized || normalized.length > 40) {
    return null;
  }
  if (TECHNICAL_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }

  const platform = detectFollowUpPlatform(normalized);
  if (!platform) {
    return null;
  }

  let remainder = normalized;
  for (const patterns of Object.values(PLATFORM_PATTERNS)) {
    for (const pattern of patterns) {
      remainder = remainder.replace(new RegExp(pattern.source, pattern.flags), " ");
    }
  }
  for (const filler of FOLLOW_UP_FILLER_PATTERNS) {
    remainder = remainder.replace(filler, " ");
  }
  remainder = remainder.replace(/\s+/g, " ").trim();
  if (remainder.length > 0) {
    return null;
  }

  return { platform };
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
  hits: DocSearchHit[],
  platform: DocFollowUpPlatform,
): boolean {
  const selectedHits = selectPlatformHits(hits, platform);
  return selectedHits.length >= 2;
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
  hits: DocSearchHit[];
  dataDir?: string;
}): Promise<StoredClarificationContext> {
  const store = await loadFollowUpContextStore(params.dataDir);
  const entry: StoredClarificationContext = {
    sessionId: params.sessionId,
    runId: params.runId,
    originalQuestion: params.originalQuestion,
    pendingQuestion: params.pendingQuestion,
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
  clarificationHits?: DocSearchHit[];
  route?: "greeting" | "memory" | "search";
  dataDir?: string;
}): Promise<void> {
  if (!params.sessionId) {
    return;
  }
  const looksLikeFollowUp = Boolean(detectClarificationFollowUpQuestion(params.question));
  if (params.summary === "platform clarification required") {
    const pendingQuestion = params.pendingQuestion ?? params.question;
    const clarificationHits = params.clarificationHits ?? params.hits;
    const entry: StoredClarificationContext = {
      sessionId: params.sessionId,
      runId: params.runId,
      originalQuestion: params.question,
      pendingQuestion,
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
      originalQuestion: params.question,
      pendingQuestion,
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
