import assert from "node:assert/strict";
import test from "node:test";
import {
  compressConversationContext,
  CONVERSATION_PROMPT_MAX_CHARS,
  type StoredConversationSummaryLike,
} from "./context-compressor.js";
import { buildQuestionState } from "./question-state.js";
import type { LearningTranscriptMessage } from "./transcript-store.js";

function makeMessage(
  role: LearningTranscriptMessage["role"],
  content: string,
  index: number,
): LearningTranscriptMessage {
  return {
    id: `msg-${index}`,
    role,
    content,
    timestamp: index,
  };
}

const baseStoredState: StoredConversationSummaryLike = {
  lastResolvedQuestion: "How to send a message on Android?",
  rollingSummary: [
    "Product: chat",
    "Platform: android",
    "Current task focus: message",
    "Last resolved question: How to send a message on Android?",
  ].join("\n"),
  stableState: {
    product: "chat",
    platform: "android",
  },
  taskAnchors: {
    focus: ["message"],
    verbs: ["send"],
    constraints: [],
    apiSymbols: [],
  },
};

void test("compressConversationContext keeps short relevant transcripts without compression", () => {
  const transcript = [
    makeMessage("user", "How to send a message on Android?", 1),
    makeMessage("assistant", "Create the params object, then call sendMessage.", 2),
  ];

  const result = compressConversationContext({
    transcript,
    question: "How to recall?",
    currentState: buildQuestionState("How to recall?"),
    stored: baseStoredState,
  });

  assert.equal(result.promptContext?.compressionTier, "none");
  assert.equal(result.promptContext?.recentTurns.length, 2);
});

void test("compressConversationContext trims irrelevant greetings and acknowledgements", () => {
  const transcript = [
    makeMessage("user", "Hello", 1),
    makeMessage("assistant", "Hi there", 2),
    makeMessage("user", "Thanks", 3),
    makeMessage("assistant", "Sure", 4),
    makeMessage("user", "How to send a message on Android?", 5),
    makeMessage("assistant", "Use sendMessage on the Android channel object.", 6),
  ];

  const result = compressConversationContext({
    transcript,
    question: "How to recall?",
    currentState: buildQuestionState("How to recall?"),
    stored: baseStoredState,
  });

  assert.equal(result.promptContext?.compressionTier, "trim_irrelevant");
  assert.equal(
    result.promptContext?.recentTurns.some((turn) => turn.content.toLowerCase().includes("hello")),
    false,
  );
});

void test("compressConversationContext falls back to summary plus recent turns for long context", () => {
  const longAssistant = "Use sendMessage with the Android client. ".repeat(40);
  const transcript = [
    makeMessage("user", "How to send a message on Android?", 1),
    makeMessage("assistant", longAssistant, 2),
    makeMessage("user", "What about deleting for myself?", 3),
    makeMessage("assistant", "Call deleteMessagesForMe for the current user.", 4),
    makeMessage("user", "Can you explain the edge cases too?", 5),
    makeMessage("assistant", longAssistant, 6),
  ];

  const result = compressConversationContext({
    transcript,
    question: "How to recall?",
    currentState: buildQuestionState("How to recall?"),
    stored: baseStoredState,
  });

  assert.equal(result.promptContext?.compressionTier, "summary_plus_recent");
  assert.equal(result.promptContext?.summaryUsed, true);
});

void test("compressConversationContext keeps the provider context within the prompt budget", () => {
  const transcript = Array.from({ length: 12 }, (_, index) =>
    makeMessage(
      index % 2 === 0 ? "user" : "assistant",
      `Turn ${index + 1}: ${"Android message follow-up ".repeat(25)}`,
      index + 1,
    ),
  );

  const result = compressConversationContext({
    transcript,
    question: "How to recall?",
    currentState: buildQuestionState("How to recall?"),
    stored: {
      ...baseStoredState,
      rollingSummary: [
        "Product: chat",
        "Platform: android",
        "Current task focus: message, recall",
        "Last resolved question: How to send a message on Android?",
        "Constraints: permission",
      ].join("\n"),
    },
  });

  assert.equal((result.promptContext?.promptChars ?? 0) <= CONVERSATION_PROMPT_MAX_CHARS, true);
});

void test("compressConversationContext falls back to summary only for very long transcripts", () => {
  const transcript = Array.from({ length: 28 }, (_, index) =>
    makeMessage(
      index % 2 === 0 ? "user" : "assistant",
      `Turn ${index + 1}: ${"Android message follow-up with delivery constraints ".repeat(10)}`,
      index + 1,
    ),
  );

  const result = compressConversationContext({
    transcript,
    question: "How to recall?",
    currentState: buildQuestionState("How to recall?"),
    stored: {
      ...baseStoredState,
      rollingSummary: [
        "Product: chat",
        "Platform: android",
        "API layer: client",
        "Current task focus: message, recall",
        "Last resolved question: How to send a message on Android?",
        "Constraints: delivery receipt, moderation policy",
      ].join("\n"),
    },
  });

  assert.equal(result.promptContext?.compressionTier, "summary_only");
  assert.equal(result.promptContext?.summaryUsed, true);
  assert.equal(result.promptContext?.recentTurns.length, 1);
  assert.equal((result.promptContext?.promptChars ?? 0) <= CONVERSATION_PROMPT_MAX_CHARS, true);
});
