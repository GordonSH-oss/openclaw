import { buildDocIndex, type DocIndexChunk } from "./doc-index.js";
import type { DocAssistantMode } from "./protocol/index.js";
import type { DocAnswerResult } from "./doc-answer.js";

type GreetingIntentKind = "greeting" | "assistant_intro" | "small_talk";

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
    (keyword) => normalizedQuestion.includes(keyword) && !SMALL_TALK_PHRASES.has(normalizedQuestion),
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

function mapAreaToStarterTopic(area: string): string | null {
  const normalizedArea = area.toLowerCase();
  if (normalizedArea.includes("chatsdk") && normalizedArea.includes("android")) {
    return "Android Chat SDK 如何初始化并开始单聊？";
  }
  if (normalizedArea.includes("chatsdk") && normalizedArea.includes("ios")) {
    return "iOS Chat SDK 如何连接用户并发送第一条消息？";
  }
  if (normalizedArea.includes("chatsdk") && normalizedArea.includes("web")) {
    return "Web Chat SDK 如何初始化并创建 DirectChannel？";
  }
  if (normalizedArea.includes("callsdk") && normalizedArea.includes("ios")) {
    return "iOS Call SDK 如何发起或接听 1 对 1 通话？";
  }
  if (normalizedArea.includes("callsdk") && normalizedArea.includes("web")) {
    return "Web Call SDK 如何发起 1 对 1 通话或配置推送？";
  }
  if (normalizedArea.includes("platform-chat-api")) {
    return "服务端消息同步、历史消息和发送回执怎么配置？";
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

async function buildDynamicStarterTopics(params: {
  docsRoot: string;
  dataDir?: string;
}): Promise<string[]> {
  const index = await buildDocIndex({
    docsRoot: params.docsRoot,
    dataDir: params.dataDir,
  });
  const suggestions: string[] = [];
  const seenAreas = new Set<string>();
  const seenSuggestions = new Set<string>();

  for (const chunk of index) {
    const area = extractAreaName(chunk);
    if (!area || seenAreas.has(area)) {
      continue;
    }
    seenAreas.add(area);
    const suggestion = mapAreaToStarterTopic(area);
    if (!suggestion || seenSuggestions.has(suggestion)) {
      continue;
    }
    seenSuggestions.add(suggestion);
    suggestions.push(suggestion);
    if (suggestions.length >= 2) {
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
  const dynamicTopics = await buildDynamicStarterTopics({
    docsRoot: params.docsRoot,
    dataDir: params.dataDir,
  });
  const fixedTopics = [
    "Android / iOS / Web Chat SDK 怎么接入和初始化？",
    "如何连接当前用户并建立聊天会话？",
    "如何开始单聊、群聊，或者发送第一条消息？",
    "如何配置推送、通知点击和会话跳转？",
    "如何发起、接听或升级音视频通话？",
  ];
  const starterTopics = Array.from(new Set([...fixedTopics, ...dynamicTopics])).slice(0, 7);

  const introLine =
    params.match.kind === "small_talk" && params.match.normalizedQuestion.includes("谢")
      ? "不客气。"
      : params.match.kind === "small_talk" &&
          (params.match.normalizedQuestion.includes("thanks") ||
            params.match.normalizedQuestion.includes("thank you"))
        ? "不客气。"
        : "我是你的 Nexconn 文档助手。";

  return {
    mode: params.mode,
    answer: [
      introLine,
      "你可以直接告诉我平台、SDK 和目标场景，我会优先根据本地文档整理成开发者可执行的回答。",
      "例如你可以这样问：",
      ...starterTopics.map((topic) => `- ${topic}`),
      "如果你已经有具体问题，也可以直接输入完整句子，比如“Android Chat SDK 如何开始 direct chat？”",
    ].join("\n"),
    summary: "guided greeting",
    citations: [],
    answerSource: "greeting",
    reviewStatus: "not_applicable",
  };
}
