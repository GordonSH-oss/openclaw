import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getStoredConversationContext,
  resolveConversationContext,
  updateConversationStateAfterAnswer,
} from "./conversation-context.js";
import { appendDocAssistantTranscriptMessage } from "./transcript-store.js";

async function makeTempDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

void test("conversation state preserves the last resolved task when a later turn asks for clarification", async () => {
  const dataDir = await makeTempDir("doc-assistant-conversation-state-");
  const sessionId = "conversation-state-session";

  await updateConversationStateAfterAnswer({
    sessionId,
    runId: "conversation-state-1",
    question: "How to send a message on Android?",
    route: "search",
    dataDir,
    answer: {
      mode: "extractive",
      answer: "Use sendMessage on Android.",
      summary: "grounded answer",
      citations: [],
      rewrittenQuestion: "How to send a message on Android?",
      trace: {
        taskFrame: {
          anchors: {
            focus: ["message"],
            verbs: ["send"],
            constraints: [],
            apiSymbols: [],
          },
        },
      },
    },
  });

  await updateConversationStateAfterAnswer({
    sessionId,
    runId: "conversation-state-2",
    question: "How do I connect?",
    route: "search",
    dataDir,
    answer: {
      mode: "extractive",
      answer: "Tell me which platform you need.",
      summary: "platform clarification required",
      citations: [],
      pendingClarificationKind: "platform",
      pendingClarificationQuestion: "How do I connect?",
    },
  });

  const stored = await getStoredConversationContext(sessionId, dataDir);
  assert.equal(stored?.lastResolvedQuestion, "How to send a message on Android?");
  assert.equal(stored?.stableState.platform, "android");
  assert.equal(stored?.taskAnchors.focus.includes("message"), true);
  assert.equal(stored?.openClarification?.kind, "platform");
  assert.equal(stored?.rollingSummary?.includes("Open clarification: platform"), true);
});

void test("resolveConversationContext can rewrite from transcript history when persisted state is missing", async () => {
  const dataDir = await makeTempDir("doc-assistant-conversation-transcript-");
  const sessionId = "conversation-transcript-session";

  await appendDocAssistantTranscriptMessage({
    sessionId,
    dataDir,
    message: {
      role: "user",
      content: "How to send a message on Android?",
      timestamp: 1,
    },
  });
  await appendDocAssistantTranscriptMessage({
    sessionId,
    dataDir,
    message: {
      role: "assistant",
      content: "Use sendMessage on the Android channel object.",
      timestamp: 2,
    },
  });
  await appendDocAssistantTranscriptMessage({
    sessionId,
    dataDir,
    message: {
      role: "user",
      content: "How to recall?",
      timestamp: 3,
    },
  });

  const resolved = await resolveConversationContext({
    question: "How to recall?",
    sessionId,
    dataDir,
  });

  assert.equal(resolved?.followUpSource, "conversation_rewrite");
  assert.equal(resolved?.effectiveQuestion, "How to recall a message on Android?");
  assert.equal(resolved?.continuedFromRunId, undefined);
  assert.equal(Boolean(resolved?.promptContext), true);
  assert.equal(resolved?.traceContext.usedStableState, true);
  assert.equal(resolved?.traceContext.source, "conversation_rewrite");
});

void test("resolveConversationContext blocks unrelated standalone topic shifts", async () => {
  const dataDir = await makeTempDir("doc-assistant-conversation-blocked-");
  const sessionId = "conversation-blocked-session";

  await updateConversationStateAfterAnswer({
    sessionId,
    runId: "conversation-blocked-1",
    question: "How to send a message on Android?",
    route: "search",
    dataDir,
    answer: {
      mode: "extractive",
      answer: "Use sendMessage on Android.",
      summary: "grounded answer",
      citations: [],
      rewrittenQuestion: "How to send a message on Android?",
      trace: {
        taskFrame: {
          anchors: {
            focus: ["message"],
            verbs: ["send"],
            constraints: [],
            apiSymbols: [],
          },
        },
      },
    },
  });

  const resolved = await resolveConversationContext({
    question: "What is a user?",
    sessionId,
    dataDir,
  });

  assert.equal(resolved?.followUpSource, undefined);
  assert.equal(resolved?.effectiveQuestion, "What is a user?");
  assert.equal(resolved?.traceContext.blockedReason, "new_topic_detected");
  assert.equal(resolved?.traceContext.source, "blocked");
});

void test("resolveConversationContext does not rewrite greetings onto prior task history", async () => {
  const dataDir = await makeTempDir("doc-assistant-conversation-greeting-");
  const sessionId = "conversation-greeting-session";

  await updateConversationStateAfterAnswer({
    sessionId,
    runId: "conversation-greeting-1",
    question: "How to send a message on Android?",
    route: "search",
    dataDir,
    answer: {
      mode: "extractive",
      answer: "Use sendMessage on Android.",
      summary: "grounded answer",
      citations: [],
      rewrittenQuestion: "How to send a message on Android?",
      trace: {
        taskFrame: {
          anchors: {
            focus: ["message"],
            verbs: ["send"],
            constraints: [],
            apiSymbols: [],
          },
        },
      },
    },
  });

  const resolved = await resolveConversationContext({
    question: "hello",
    sessionId,
    dataDir,
  });

  assert.equal(resolved?.followUpSource, undefined);
  assert.equal(resolved?.effectiveQuestion, "hello");
  assert.equal(resolved?.traceContext.blockedReason, "greeting_or_small_talk");
  assert.equal(resolved?.traceContext.source, "blocked");
});
