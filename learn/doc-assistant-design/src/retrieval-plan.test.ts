import assert from "node:assert/strict";
import test from "node:test";
import { buildQuestionState } from "./question-state.js";
import { buildRetrievalPlan } from "./retrieval-plan.js";

void test("buildRetrievalPlan creates primary and expansion queries for procedural questions", () => {
  const plan = buildRetrievalPlan({
    state: buildQuestionState("How to send a message on Android?"),
    maxResults: 5,
  });

  assert.equal(plan.primaryQueries[0]?.purpose, "primary_procedural");
  assert.equal(
    plan.expansionQueries.some((query) => query.purpose === "prerequisite"),
    true,
  );
  assert.equal(
    plan.expansionQueries.some((query) => query.purpose === "api"),
    true,
  );
});

void test("buildRetrievalPlan keeps concept questions on concept retrieval", () => {
  const plan = buildRetrievalPlan({
    state: buildQuestionState("What is community channel?"),
    maxResults: 5,
  });

  assert.equal(plan.primaryQueries[0]?.purpose, "primary_concept");
  assert.equal(plan.primaryQueries[0]?.bucket, "concept");
});

void test("buildRetrievalPlan splits mixed questions into concept and procedural primaries", () => {
  const plan = buildRetrievalPlan({
    state: buildQuestionState("What is community channel? How to create it?"),
    maxResults: 5,
  });

  assert.equal(plan.primaryQueries.length, 2);
  assert.equal(plan.primaryQueries[0]?.purpose, "primary_concept");
  assert.equal(plan.primaryQueries[1]?.purpose, "primary_procedural");
});

void test("buildRetrievalPlan skips generic prerequisite expansion for off-intent questions without doc anchors", () => {
  const plan = buildRetrievalPlan({
    state: buildQuestionState("How do I configure Kubernetes liveness probes for this SDK?"),
    maxResults: 5,
  });

  assert.equal(
    plan.expansionQueries.some((query) => query.purpose === "prerequisite"),
    false,
  );
});
