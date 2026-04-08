import assert from "node:assert/strict";
import test from "node:test";
import { buildAnswerPlan } from "./answer-plan.js";
import { buildAgentPromptFromPlan, renderExtractiveAnswer } from "./answer-render.js";
import { DOCUMENT_CONTEXT_REQUEST_START } from "./document-context.js";
import type { EvidencePack } from "./evidence-pack.js";
import type { DocSearchHit } from "./protocol/index.js";
import { buildQuestionState } from "./question-state.js";

const state = buildQuestionState("How to send a targeted message on Web?");
const evidence: EvidencePack = {
  questionState: state,
  warnings: ["trimmed"],
  trimEvents: [{ reason: "total_budget", droppedGroupIds: ["overflow"] }],
  groups: [
    {
      id: "task-1",
      purpose: "task_steps",
      path: "docs/chatsdk-web/group-channel/direct.md",
      heading: "Send a targeted message",
      citations: [],
      summary: "Use directedUserIds to target members.",
      snippets: ["Set directedUserIds before sendMessage."],
      score: 100,
      platform: "web",
    },
  ],
};

const documentAccessHits: DocSearchHit[] = [
  {
    path: "docs/chatsdk-web/group-channel/direct.md",
    heading: "Send a targeted message",
    startLine: 20,
    endLine: 48,
    snippet: "Set directedUserIds before sendMessage.",
    text: "Set directedUserIds before sendMessage and review the surrounding caveats in the same page.",
    score: 100,
  },
];

void test("renderExtractiveAnswer preserves section order from the plan", () => {
  const plan = buildAnswerPlan({
    question: state.rawQuestion,
    state,
    evidence,
  });
  const rendered = renderExtractiveAnswer({
    question: state.rawQuestion,
    state,
    language: "en",
    plan,
    evidence,
  });
  assert.equal(rendered.includes("Steps"), true);
});

void test("buildAgentPromptFromPlan includes plan and evidence", () => {
  const plan = buildAnswerPlan({
    question: state.rawQuestion,
    state,
    evidence,
  });
  const prompt = buildAgentPromptFromPlan({
    question: state.rawQuestion,
    state,
    language: "en",
    plan,
    evidence,
    draftAnswer: "Draft answer",
    conversationContext: {
      summary: "Platform: web\nLast resolved question: How to send a targeted message on Web?",
      recentTurns: [
        { role: "user", content: "How to send a targeted message on Web?" },
        { role: "assistant", content: "Use directedUserIds before sendMessage." },
      ],
      compressionTier: "trim_irrelevant",
      promptChars: 120,
      selectedTurnCount: 2,
      summaryUsed: true,
    },
    documentAccessHits,
  });
  assert.equal(prompt.includes("Conversation context:"), true);
  assert.equal(prompt.includes("Last resolved question"), true);
  assert.equal(prompt.includes("User: How to send a targeted message on Web?"), true);
  assert.equal(prompt.includes("Plan kind"), true);
  assert.equal(prompt.includes("directedUserIds"), true);
  assert.equal(prompt.includes("Bounded source-document access"), true);
  assert.equal(prompt.includes(DOCUMENT_CONTEXT_REQUEST_START), true);
  assert.equal(prompt.includes("FINAL_ANSWER_START"), true);
});

void test("buildAgentPromptFromPlan omits conversation context when none is provided", () => {
  const plan = buildAnswerPlan({
    question: state.rawQuestion,
    state,
    evidence,
  });
  const prompt = buildAgentPromptFromPlan({
    question: state.rawQuestion,
    state,
    language: "en",
    plan,
    evidence,
    draftAnswer: "Draft answer",
  });

  assert.equal(prompt.includes("Conversation context:"), false);
  assert.equal(prompt.includes("Answer plan and evidence:"), true);
});
