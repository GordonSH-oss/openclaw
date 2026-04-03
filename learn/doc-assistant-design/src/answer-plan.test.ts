import assert from "node:assert/strict";
import test from "node:test";
import { buildAnswerPlan } from "./answer-plan.js";
import type { EvidencePack } from "./evidence-pack.js";
import { buildQuestionState } from "./question-state.js";

function makeEvidencePack(kind: "concept" | "guide" | "mixed"): EvidencePack {
  const state = buildQuestionState(
    kind === "concept"
      ? "What is community channel?"
      : kind === "guide"
        ? "How to send a message on Android?"
        : "What is community channel? How to create it on Android?",
  );
  return {
    questionState: state,
    warnings: [],
    trimEvents: [],
    groups:
      kind === "concept"
        ? [
            {
              id: "definition-1",
              purpose: "definition",
              path: "docs/example.md",
              citations: [],
              summary: "Definition summary",
              snippets: ["Definition snippet"],
              score: 100,
              platform: "general",
            },
          ]
        : kind === "guide"
          ? [
              {
                id: "task-1",
                purpose: "task_steps",
                path: "docs/send.md",
                citations: [],
                summary: "Task summary",
                snippets: ["Task snippet"],
                score: 100,
                platform: "android",
              },
              {
                id: "api-1",
                purpose: "api_reference",
                path: "docs/send.md",
                citations: [],
                summary: "API summary",
                snippets: ["API snippet"],
                score: 90,
                platform: "android",
              },
            ]
          : [
              {
                id: "definition-1",
                purpose: "definition",
                path: "docs/community.md",
                citations: [],
                summary: "Definition summary",
                snippets: ["Definition snippet"],
                score: 100,
                platform: "general",
              },
              {
                id: "task-1",
                purpose: "task_steps",
                path: "docs/community.md",
                citations: [],
                summary: "Task summary",
                snippets: ["Task snippet"],
                score: 98,
                platform: "android",
              },
            ],
  };
}

void test("buildAnswerPlan returns concept sections", () => {
  const evidence = makeEvidencePack("concept");
  const plan = buildAnswerPlan({
    question: evidence.questionState.rawQuestion,
    state: evidence.questionState,
    evidence,
  });
  assert.equal(plan.kind, "concept");
  assert.equal(plan.sections[0]?.title, "Definition");
});

void test("buildAnswerPlan returns guide sections", () => {
  const evidence = makeEvidencePack("guide");
  const plan = buildAnswerPlan({
    question: evidence.questionState.rawQuestion,
    state: evidence.questionState,
    evidence,
  });
  assert.equal(plan.kind, "guide");
  assert.equal(
    plan.sections.some((section) => section.title === "Steps"),
    true,
  );
  assert.equal(
    plan.sections.some((section) => section.title === "Key APIs or docs"),
    true,
  );
});

void test("buildAnswerPlan returns mixed sections", () => {
  const evidence = makeEvidencePack("mixed");
  const plan = buildAnswerPlan({
    question: evidence.questionState.rawQuestion,
    state: evidence.questionState,
    evidence,
  });
  assert.equal(plan.kind, "mixed");
  assert.deepEqual(
    plan.sections.map((section) => section.title),
    ["Definition", "Steps", "Key APIs or docs", "Notes"],
  );
});
