import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  updateClarificationStateAfterAnswer,
  getStoredClarificationContext,
} from "./follow-up-context.js";
import { appendQuestionHistoryEntry, loadQuestionHistory } from "./question-history.js";

void test("question history appends remain readable under concurrent writes", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-history-concurrency-"));
  await Promise.all([
    appendQuestionHistoryEntry({
      dataDir,
      entry: {
        runId: "run-a",
        userId: "user-1",
        sessionKey: "session-1",
        question: "How to send a message?",
        mode: "extractive",
        askedAt: Date.now(),
        completedAt: Date.now(),
        terminalStatus: "ok",
        summary: "guided answer from 1 documentation chunks",
        citationCount: 1,
        answer: "Answer A",
      },
    }),
    appendQuestionHistoryEntry({
      dataDir,
      entry: {
        runId: "run-b",
        userId: "user-1",
        sessionKey: "session-1",
        question: "How to connect?",
        mode: "extractive",
        askedAt: Date.now(),
        completedAt: Date.now(),
        terminalStatus: "ok",
        summary: "guided answer from 1 documentation chunks",
        citationCount: 1,
        answer: "Answer B",
      },
    }),
  ]);

  const entries = await loadQuestionHistory({ dataDir });
  assert.equal(entries.length, 2);
});

void test("follow-up clarification store stays parseable under concurrent session updates", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-followup-concurrency-"));
  const hits = [
    {
      path: "docs/chatsdk-android/message/send.md",
      heading: "Send a text message",
      startLine: 1,
      endLine: 5,
      snippet: "Send a text message",
      score: 100,
      text: "Send a text message",
    },
  ];

  await Promise.all([
    updateClarificationStateAfterAnswer({
      sessionId: "session-1",
      runId: "run-a",
      question: "How to send my first message?",
      hits,
      summary: "platform clarification required",
      pendingQuestion: "How to send my first message?",
      clarificationKind: "platform",
      clarificationHits: hits,
      route: "search",
      dataDir,
    }),
    updateClarificationStateAfterAnswer({
      sessionId: "session-1",
      runId: "run-b",
      question: "How to start a direct chat?",
      hits,
      summary: "platform clarification required",
      pendingQuestion: "How to start a direct chat?",
      clarificationKind: "platform",
      clarificationHits: hits,
      route: "search",
      dataDir,
    }),
  ]);

  const stored = await getStoredClarificationContext("session-1", dataDir);
  assert.ok(stored);
  assert.equal(stored?.clarificationKind, "platform");
});
