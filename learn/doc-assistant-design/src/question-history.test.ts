import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DocsTerminalResult } from "./protocol/index.js";
import {
  appendQuestionHistoryEntry,
  loadQuestionHistory,
  sanitizeHistoryDebugAnswers,
  sanitizeHistoryTaskFrame,
  summarizeQuestionOutcome,
} from "./question-history.js";

function makeTerminal(overrides: Partial<DocsTerminalResult> = {}): DocsTerminalResult {
  return {
    runId: "history-run-1",
    status: "ok",
    mode: "agent",
    answer: "Answer",
    summary: "answered with mock/learning-primary",
    citations: [],
    answerSource: "generated",
    ...overrides,
  };
}

void test("summarizeQuestionOutcome marks non-authoritative answer surfaces as not answered", () => {
  const outcome = summarizeQuestionOutcome(
    makeTerminal({
      selectedProvider: "mock",
      selectedModel: "learning-primary",
      answerSurface: {
        kind: "learning_mock",
        trust: "non_authoritative",
        outputContract: "sentinel_prompt",
      },
    }),
  );

  assert.deepEqual(outcome, {
    answered: false,
    answerOutcome: "non_authoritative",
  });
});

void test("summarizeQuestionOutcome keeps authoritative generated answers as answered", () => {
  const outcome = summarizeQuestionOutcome(
    makeTerminal({
      mode: "extractive",
      summary: "guided answer from 1 documentation chunks",
      answerSurface: {
        kind: "extractive",
        trust: "not_applicable",
        outputContract: "grounded_extractive",
      },
    }),
  );

  assert.deepEqual(outcome, {
    answered: true,
    answerOutcome: "answered",
  });
});

void test("sanitizeHistoryTaskFrame keeps only string task-frame fields", () => {
  const frame = sanitizeHistoryTaskFrame({
    responseMode: "procedure",
    platform: "web",
    anchors: {
      focus: ["message", "webhook signature"],
      constraints: ["permission"],
      apiSymbols: ["MessageHandler"],
    },
    coverage: {
      matched: ["message"],
      missing: ["permission"],
    },
    ignored: 123,
  });

  assert.deepEqual(frame, {
    responseMode: "procedure",
    platform: "web",
    anchors: {
      focus: ["message", "webhook signature"],
      constraints: ["permission"],
      apiSymbols: ["MessageHandler"],
    },
    coverage: {
      matched: ["message"],
      missing: ["permission"],
    },
  });
});

void test("sanitizeHistoryDebugAnswers keeps only known debug answer fields", () => {
  const debugAnswers = sanitizeHistoryDebugAnswers({
    finalAnswerSource: "grounded_fallback",
    groundedAnswer: "Grounded answer",
    providerAnswer: "Provider answer",
    providerError: "Provider failed",
    providerKind: "openai_compatible",
    ignored: 123,
  });

  assert.deepEqual(debugAnswers, {
    finalAnswerSource: "grounded_fallback",
    groundedAnswer: "Grounded answer",
    providerAnswer: "Provider answer",
    providerError: "Provider failed",
    providerKind: "openai_compatible",
  });
});

void test("question history preview preserves step structure instead of flattening sections", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-history-preview-"));
  await appendQuestionHistoryEntry({
    dataDir,
    entry: {
      runId: "history-preview-1",
      userId: "user-1",
      sessionKey: "session-1",
      question: "How to send a message on iOS?",
      mode: "agent",
      askedAt: Date.now(),
      completedAt: Date.now(),
      terminalStatus: "ok",
      summary: "answered with mock/learning-primary",
      citationCount: 1,
      answer: [
        "Use the documented flow below to send a message on iOS.",
        "",
        "Steps",
        "1. Build `SendTextMessageParams`, then call `sendMessage` to send the text message.[docs/chatsdk-ios/message/send.md:28-100]",
        "",
        "Key APIs or docs",
        "`SendMessageParams`",
        "`sendMessage`",
      ].join("\n"),
      answerSurface: {
        kind: "learning_mock",
        trust: "non_authoritative",
        outputContract: "sentinel_prompt",
      },
    },
  });

  const entries = await loadQuestionHistory({ dataDir });
  assert.equal(entries[0]?.answerPreview.includes("Steps\n1. Build"), true);
  assert.equal(entries[0]?.answerPreview.includes("Key APIs or docs"), true);
  assert.equal(
    entries[0]?.answerPreview.includes(
      "Use the documented flow below to send a message on iOS. Steps 1. Build",
    ),
    false,
  );
});

void test("question history persists debug answer comparisons for agent runs", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-history-debug-"));
  await appendQuestionHistoryEntry({
    dataDir,
    entry: {
      runId: "history-debug-1",
      userId: "user-1",
      sessionKey: "session-1",
      question: "How do I configure push settings?",
      mode: "agent",
      askedAt: Date.now(),
      completedAt: Date.now(),
      terminalStatus: "ok",
      summary: "guided answer from 1 documentation chunks",
      citationCount: 1,
      answer: "Grounded fallback answer",
      debugAnswers: {
        finalAnswerSource: "grounded_fallback",
        groundedAnswer: "Grounded fallback answer",
        providerAnswer: "Question: prompt echo",
        providerError: "OpenAI-compatible response echoed prompt scaffolding",
        providerKind: "openai_compatible",
      },
    },
  });

  const entries = await loadQuestionHistory({ dataDir });
  assert.equal(entries[0]?.debugAnswers?.finalAnswerSource, "grounded_fallback");
  assert.equal(entries[0]?.debugAnswers?.providerKind, "openai_compatible");
  assert.equal(entries[0]?.debugAnswers?.providerAnswer, "Question: prompt echo");
});
