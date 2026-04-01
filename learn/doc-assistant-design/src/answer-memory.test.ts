import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  approveAnswerMemoryEntry,
  enqueueGeneratedAnswerMemory,
  findAnswerMemoryMatch,
  normalizeMemoryQuestion,
  rejectAnswerMemoryEntry,
  replaceAnswerMemoryEntries,
  updateAnswerMemoryEntry,
} from "./answer-memory.js";
import type { AnswerMemoryEntry, DocsTerminalResult } from "./protocol/index.js";

async function makeTempDir(name: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

function makeEntry(params: {
  entryId: string;
  question: string;
  answer: string;
  reviewStatus: "pending_review" | "approved_standard" | "rejected";
  questionVariants?: string[];
}): AnswerMemoryEntry {
  const now = Date.now();
  const variants = [params.question, ...(params.questionVariants ?? [])];
  return {
    entryId: params.entryId,
    question: params.question,
    normalizedQuestion: normalizeMemoryQuestion(params.question),
    questionVariants: variants,
    normalizedQuestionVariants: variants.map((value) => normalizeMemoryQuestion(value)),
    answer: params.answer,
    summary: "memory summary",
    citations: [],
    mode: "extractive",
    reviewStatus: params.reviewStatus,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    hitCount: 1,
    provenance: "generated_from_docs",
  };
}

function makeTerminal(runId: string, answer: string): DocsTerminalResult {
  return {
    runId,
    status: "ok",
    mode: "extractive",
    answer,
    summary: "generated answer",
    citations: [],
    answerSource: "generated",
    reviewStatus: "not_applicable",
  };
}

void test("findAnswerMemoryMatch prefers approved standards over pending drafts", async () => {
  const dataDir = await makeTempDir("doc-assistant-memory-match");
  await replaceAnswerMemoryEntries(
    [
      makeEntry({
        entryId: "draft-1",
        question: "How to start a direct chat on Android?",
        answer: "draft answer",
        reviewStatus: "pending_review",
      }),
      makeEntry({
        entryId: "approved-1",
        question: "How to start a direct chat on Android?",
        questionVariants: ["How do I start a direct chat on Android?"],
        answer: "approved answer",
        reviewStatus: "approved_standard",
      }),
    ],
    dataDir,
  );

  const match = await findAnswerMemoryMatch({
    question: "How do I start a direct chat on Android?",
    dataDir,
  });
  assert.equal(match?.answerSource, "memory_standard");
  assert.equal(match?.entry.entryId, "approved-1");
});

void test("enqueueGeneratedAnswerMemory dedupes near-identical pending questions but pending entries are not matched", async () => {
  const dataDir = await makeTempDir("doc-assistant-memory-dedupe");
  const first = await enqueueGeneratedAnswerMemory({
    dataDir,
    question: "How do I configure push settings for the iOS Call SDK?",
    terminal: makeTerminal("run-1", "first answer"),
    mode: "extractive",
  });
  const second = await enqueueGeneratedAnswerMemory({
    dataDir,
    question: "How can I configure push settings for iOS Call SDK?",
    terminal: makeTerminal("run-2", "updated answer"),
    mode: "extractive",
  });

  assert.equal(first.entryId, second.entryId);
  const match = await findAnswerMemoryMatch({
    question: "How can I configure push settings for iOS Call SDK?",
    dataDir,
  });
  assert.equal(match, null);
});

void test("findAnswerMemoryMatch ignores approved entries that are only clarification prompts", async () => {
  const dataDir = await makeTempDir("doc-assistant-memory-ignore-clarification");
  await replaceAnswerMemoryEntries(
    [
      {
        ...makeEntry({
          entryId: "approved-clarify",
          question: "How to start a chat?",
          answer: "请先告诉我平台。",
          reviewStatus: "approved_standard",
        }),
        summary: "platform clarification required",
      },
    ],
    dataDir,
  );

  const match = await findAnswerMemoryMatch({
    question: "How to start a chat on Android?",
    dataDir,
  });
  assert.equal(match, null);
});

void test("approve, update, and reject memory entries mutate review state", async () => {
  const dataDir = await makeTempDir("doc-assistant-memory-review");
  await replaceAnswerMemoryEntries(
    [
      makeEntry({
        entryId: "pending-1",
        question: "How do I check my Node version for OpenClaw?",
        answer: "draft answer",
        reviewStatus: "pending_review",
      }),
    ],
    dataDir,
  );

  const updated = await updateAnswerMemoryEntry({
    dataDir,
    entryId: "pending-1",
    editedAnswer: "edited draft answer",
    questionVariants: ["What Node version does OpenClaw require?"],
  });
  assert.equal(updated?.answer, "edited draft answer");
  assert.equal(
    updated?.questionVariants.includes("What Node version does OpenClaw require?"),
    true,
  );

  const approved = await approveAnswerMemoryEntry({
    dataDir,
    entryId: "pending-1",
    editedAnswer: "approved standard answer",
  });
  assert.equal(approved?.reviewStatus, "approved_standard");
  assert.equal(approved?.answer, "approved standard answer");

  const rejected = await rejectAnswerMemoryEntry({
    dataDir,
    entryId: "pending-1",
    reason: "stale answer",
  });
  assert.equal(rejected?.reviewStatus, "rejected");
  const match = await findAnswerMemoryMatch({
    question: "How do I check my Node version for OpenClaw?",
    dataDir,
  });
  assert.equal(match, null);
});
