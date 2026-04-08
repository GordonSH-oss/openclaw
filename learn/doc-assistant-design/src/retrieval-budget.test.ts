import assert from "node:assert/strict";
import test from "node:test";
import { buildQuestionState } from "./question-state.js";
import { resolveRetrievalBudget } from "./retrieval-budget.js";

void test("resolveRetrievalBudget keeps straightforward procedural questions on a small default budget", () => {
  const budget = resolveRetrievalBudget({
    state: buildQuestionState("How do I send a message on Android?"),
  });

  assert.equal(budget.source, "dynamic");
  assert.equal(budget.hitLimit, 4);
  assert.equal(budget.retryHitLimit, 8);
});

void test("resolveRetrievalBudget expands the budget for broad mixed questions", () => {
  const budget = resolveRetrievalBudget({
    state: buildQuestionState("What is Chat SDK? How do I integrate it on Web?"),
  });

  assert.equal(budget.source, "dynamic");
  assert.equal(budget.hitLimit >= 8, true);
  assert.equal(budget.maxExpansionQueries >= 5, true);
  assert.equal(budget.reasons.includes("multi_step_question"), true);
});

void test("resolveRetrievalBudget treats maxResults as an explicit override", () => {
  const budget = resolveRetrievalBudget({
    state: buildQuestionState("How do I send a message on Android?"),
    overrideMaxResults: 9,
  });

  assert.equal(budget.source, "override");
  assert.equal(budget.hitLimit, 9);
  assert.equal(budget.retryHitLimit, 9);
  assert.deepEqual(budget.reasons, ["manual_override"]);
});
