import { normalizeSearchText } from "./search-text.js";

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

export type DocQuestionIntent = "concept" | "procedural";
export type DocQuestionPlanKind = DocQuestionIntent | "mixed";
export type DocProceduralTaskKind =
  | "first_message"
  | "send_message"
  | "start_chat"
  | "channel_creation"
  | "generic";
export type DocPreferredDocShape = "quickstart_step" | "specialized_task";
export type DocQuestionPlanStep = {
  intent: DocQuestionIntent;
  question: string;
  order: number;
};
export type DocQuestionPlan = {
  kind: DocQuestionPlanKind;
  steps: DocQuestionPlanStep[];
};

function trimQuestionSegment(text: string): string {
  return text
    .trim()
    .replace(/^[,;:，；：]+/u, "")
    .replace(/[?？!！.。]+$/u, "")
    .trim();
}

function splitQuestionIntoSegments(question: string): string[] {
  // Mixed questions often arrive as "what is X and then how do I use it?".
  // Split those into smaller retrieval units before planning buckets.
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

function inheritReferentsAcrossSegments(rawSteps: string[]): string[] {
  const steps: string[] = [];
  let lastConceptReferent: string | undefined;

  for (const rawStep of rawSteps) {
    const intent = detectQuestionIntentForSegment(rawStep);
    let stepQuestion = rawStep;
    if (intent === "concept") {
      lastConceptReferent = extractQuestionReferent(rawStep) ?? lastConceptReferent;
    } else if (lastConceptReferent && hasReferencePronoun(rawStep)) {
      // A follow-up like "how do I create it?" should keep pointing at the
      // concept from the previous segment instead of retrieving for a bare pronoun.
      const normalizedReferent = normalizeSearchText(lastConceptReferent);
      if (normalizedReferent && !normalizeSearchText(rawStep).includes(normalizedReferent)) {
        stepQuestion = rewriteQuestionWithReferent(rawStep, lastConceptReferent);
      }
    }
    steps.push(stepQuestion);
  }

  return steps;
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
  const mentionsCallFlow =
    normalized.includes("call sdk") ||
    normalized.includes("callsdk") ||
    /\b(?:audio|video|group|incoming|outgoing|one to one|1 to 1)\s+call\b/.test(normalized) ||
    /\b(?:start|make|place|accept|answer|upgrade|receive|join)\b[\w\s-]{0,40}\bcall\b/.test(
      normalized,
    );
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
  if (mentionsCallFlow) {
    return "generic";
  }
  if (
    normalized.includes("start") ||
    normalized.includes("begin") ||
    normalized.includes("open") ||
    (normalized.includes("chat") && !normalized.includes("wechat"))
  ) {
    // Chat-start questions are broader than a pure send-message request and
    // usually benefit from quickstart or onboarding-shaped docs.
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
  if (
    (/^how (?:to|do|can) .*chat\b/.test(normalized) ||
      /^如何.*聊天/.test(normalized) ||
      /^怎么.*聊天/.test(normalized) ||
      normalized === "how to chat" ||
      normalized === "how do i chat") &&
    !normalized.includes("message") &&
    !normalized.includes("thread") &&
    !normalized.includes("mention")
  ) {
    return "quickstart_step";
  }
  return "specialized_task";
}
