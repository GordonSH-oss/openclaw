import { detectQuestionLanguage, type AnswerLanguage } from "./answer-language.js";
import { decideAnswerability } from "./answerability.js";
import { decideClarification } from "./clarification-policy.js";
import type { DocAnswerResult } from "./doc-answer.js";
import { buildDocIndex, type DocIndexChunk } from "./doc-index.js";
import { searchDocs } from "./doc-search.js";
import type { DocAssistantMode } from "./protocol/index.js";
import { buildQuestionState } from "./question-state.js";

type GreetingIntentKind = "greeting" | "assistant_intro" | "small_talk";
type StarterTopic = {
  display: string;
  validationQuery: string;
};

export type GreetingIntentMatch = {
  kind: GreetingIntentKind;
  normalizedQuestion: string;
};

const GREETING_PHRASES = new Set([
  "hello",
  "hello there",
  "hey",
  "hi",
  "嗨",
  "你好",
  "您好",
  "哈喽",
]);

const INTRO_PHRASES = new Set([
  "what can you do",
  "who are you",
  "你是谁",
  "你是什么",
  "你能做什么",
  "你可以做什么",
]);

const SMALL_TALK_PHRASES = new Set([
  "good evening",
  "good morning",
  "thanks",
  "thank you",
  "morning",
  "在吗",
  "在不在",
  "谢谢",
  "谢谢你",
]);

const TECHNICAL_KEYWORDS = [
  "android",
  "api",
  "call",
  "channel",
  "chat",
  "config",
  "configure",
  "connect",
  "conversation",
  "direct",
  "flutter",
  "group",
  "import",
  "init",
  "initialize",
  "ios",
  "javascript",
  "message",
  "model",
  "push",
  "sdk",
  "send",
  "server",
  "token",
  "web",
  "单聊",
  "发消息",
  "发起",
  "如何",
  "怎么",
  "接入",
  "推送",
  "消息",
  "群聊",
  "聊天",
  "连接",
  "配置",
  "通话",
  "初始化",
];

function normalizeGreetingQuestion(question: string): string {
  return question
    .trim()
    .toLowerCase()
    .replace(/[!?.,;:()[\]{}"'`~]+/g, " ")
    .replace(/[，。！？；：（）【】《》、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasTechnicalSignals(question: string, normalizedQuestion: string): boolean {
  if (question.includes("`")) {
    return true;
  }
  if (/[A-Za-z0-9]+[./:_-][A-Za-z0-9]+/.test(question)) {
    return true;
  }
  return TECHNICAL_KEYWORDS.some(
    (keyword) =>
      normalizedQuestion.includes(keyword) && !SMALL_TALK_PHRASES.has(normalizedQuestion),
  );
}

function isShortChattyQuestion(normalizedQuestion: string): boolean {
  if (!normalizedQuestion) {
    return false;
  }
  if (normalizedQuestion.length > 36) {
    return false;
  }
  const tokens = normalizedQuestion.split(" ").filter(Boolean);
  return tokens.length <= 8;
}

export function detectGreetingIntent(question: string): GreetingIntentMatch | null {
  const normalizedQuestion = normalizeGreetingQuestion(question);
  if (!isShortChattyQuestion(normalizedQuestion)) {
    return null;
  }
  if (hasTechnicalSignals(question, normalizedQuestion)) {
    return null;
  }
  if (GREETING_PHRASES.has(normalizedQuestion)) {
    return {
      kind: "greeting",
      normalizedQuestion,
    };
  }
  if (INTRO_PHRASES.has(normalizedQuestion)) {
    return {
      kind: "assistant_intro",
      normalizedQuestion,
    };
  }
  if (SMALL_TALK_PHRASES.has(normalizedQuestion)) {
    return {
      kind: "small_talk",
      normalizedQuestion,
    };
  }
  return null;
}

function mapAreaToStarterTopic(area: string, language: AnswerLanguage): StarterTopic | null {
  const normalizedArea = area.toLowerCase();
  if (normalizedArea.includes("chatsdk") && normalizedArea.includes("android")) {
    return {
      display:
        language === "zh"
          ? "Android Chat SDK 如何初始化并开始单聊？"
          : "How do I initialize the Android Chat SDK and start a direct chat?",
      validationQuery: "How do I initialize the Android Chat SDK and start a direct chat?",
    };
  }
  if (normalizedArea.includes("chatsdk") && normalizedArea.includes("ios")) {
    return {
      display:
        language === "zh"
          ? "iOS Chat SDK 如何连接用户并发送第一条消息？"
          : "How do I connect a user in the iOS Chat SDK and send the first message?",
      validationQuery: "How do I connect a user in the iOS Chat SDK and send the first message?",
    };
  }
  if (normalizedArea.includes("chatsdk") && normalizedArea.includes("web")) {
    return {
      display:
        language === "zh"
          ? "Web Chat SDK 如何初始化并创建 DirectChannel？"
          : "How do I initialize the Web Chat SDK and create a DirectChannel?",
      validationQuery: "How do I initialize the Web Chat SDK and create a DirectChannel?",
    };
  }
  if (normalizedArea.includes("callsdk") && normalizedArea.includes("ios")) {
    return {
      display:
        language === "zh"
          ? "iOS Call SDK 如何发起或接听 1 对 1 通话？"
          : "How do I start or accept a 1-to-1 call in the iOS Call SDK?",
      validationQuery: "How do I start or accept a 1-to-1 call in the iOS Call SDK?",
    };
  }
  if (normalizedArea.includes("callsdk") && normalizedArea.includes("web")) {
    return {
      display:
        language === "zh"
          ? "Web Call SDK 如何发起 1 对 1 通话或配置推送？"
          : "How do I start a 1-to-1 call or configure push in the Web Call SDK?",
      validationQuery: "How do I start a 1-to-1 call or configure push in the Web Call SDK?",
    };
  }
  if (normalizedArea.includes("platform-chat-api")) {
    return {
      display:
        language === "zh"
          ? "服务端消息同步、历史消息和发送回执怎么配置？"
          : "How do I configure server-side message sync, message history, and delivery callbacks?",
      validationQuery:
        "How do I configure server-side message sync, message history, and delivery callbacks?",
    };
  }
  return null;
}

function extractAreaName(chunk: DocIndexChunk): string | null {
  const segments = chunk.relativePath.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  return segments[1] ?? null;
}

async function isAnswerableStarterTopic(params: {
  topic: StarterTopic;
  docsRoot: string;
  dataDir?: string;
}): Promise<boolean> {
  const state = buildQuestionState(params.topic.validationQuery);
  const hits = await searchDocs({
    query: params.topic.validationQuery,
    docsRoot: params.docsRoot,
    dataDir: params.dataDir,
    maxResults: 5,
  });
  if (hits.length === 0) {
    return false;
  }
  const clarification = decideClarification({
    state,
    hits,
  });
  if (clarification.shouldClarify) {
    return false;
  }
  return (
    decideAnswerability({
      question: params.topic.validationQuery,
      state,
      hits,
    }).verdict === "answerable"
  );
}

async function buildValidatedStarterTopics(params: {
  docsRoot: string;
  dataDir?: string;
  language: AnswerLanguage;
}): Promise<string[]> {
  const index = await buildDocIndex({
    docsRoot: params.docsRoot,
    dataDir: params.dataDir,
  });
  const candidates: StarterTopic[] = [];
  const seenAreas = new Set<string>();
  const seenSuggestions = new Set<string>();

  for (const chunk of index) {
    const area = extractAreaName(chunk);
    if (!area || seenAreas.has(area)) {
      continue;
    }
    seenAreas.add(area);
    const suggestion = mapAreaToStarterTopic(area, params.language);
    if (!suggestion || seenSuggestions.has(suggestion.display)) {
      continue;
    }
    seenSuggestions.add(suggestion.display);
    candidates.push(suggestion);
  }

  const suggestions: string[] = [];
  for (const candidate of candidates) {
    if (
      !(await isAnswerableStarterTopic({
        topic: candidate,
        docsRoot: params.docsRoot,
        dataDir: params.dataDir,
      }))
    ) {
      continue;
    }
    suggestions.push(candidate.display);
    if (suggestions.length >= 5) {
      break;
    }
  }

  return suggestions;
}

export async function buildGreetingAnswer(params: {
  question: string;
  mode: DocAssistantMode;
  docsRoot: string;
  dataDir?: string;
  match: GreetingIntentMatch;
}): Promise<DocAnswerResult> {
  const language = detectQuestionLanguage(params.question);
  const starterTopics = await buildValidatedStarterTopics({
    docsRoot: params.docsRoot,
    dataDir: params.dataDir,
    language,
  });
  const directExample = starterTopics[0];

  const introLine =
    params.match.kind === "small_talk" && params.match.normalizedQuestion.includes("谢")
      ? "不客气。"
      : params.match.kind === "small_talk" &&
          (params.match.normalizedQuestion.includes("thanks") ||
            params.match.normalizedQuestion.includes("thank you"))
        ? "You're welcome."
        : language === "zh"
          ? "我是你的 Nexconn 文档助手。"
          : "I'm your Nexconn documentation assistant.";

  return {
    mode: params.mode,
    answer: [
      introLine,
      language === "zh"
        ? "你可以直接告诉我平台、SDK 和目标场景，我会优先根据本地文档整理成开发者可执行的回答。"
        : "Tell me the platform, SDK, and target scenario, and I’ll answer from the local docs first.",
      starterTopics.length > 0 ? (language === "zh" ? "例如你可以这样问：" : "For example:") : "",
      ...starterTopics.map((topic) => `- ${topic}`),
      directExample
        ? language === "zh"
          ? `如果你已经有具体问题，也可以直接输入完整句子，比如“${directExample}”`
          : `If you already have a concrete question, ask it directly, for example: "${directExample}"`
        : language === "zh"
          ? "如果你已经有具体问题，也可以直接输入完整句子。"
          : "If you already have a concrete question, ask it directly.",
    ].join("\n"),
    summary: "guided greeting",
    citations: [],
    answerSource: "greeting",
    reviewStatus: "not_applicable",
  };
}
