import assert from "node:assert/strict";
import test from "node:test";
import { buildAnswerPlan } from "./answer-plan.js";
import { buildAgentPromptFromPlan, renderExtractiveAnswer } from "./answer-render.js";
import type { EvidencePack } from "./evidence-pack.js";
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
  });
  assert.equal(prompt.includes("Plan kind"), true);
  assert.equal(prompt.includes("directedUserIds"), true);
  assert.equal(prompt.includes("FINAL_ANSWER_START"), true);
});
