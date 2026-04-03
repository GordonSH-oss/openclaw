import assert from "node:assert/strict";
import test from "node:test";
import { DOC_ASSISTANT_EVAL_CASES } from "./eval-cases.js";
import {
  evaluateAnswerCase,
  evaluateAnswerSurface,
  evaluateRetrievalCase,
  evaluateValidationCase,
} from "./eval.js";

void test("evaluation cases use unique ids", () => {
  const ids = new Set<string>();
  for (const caseDef of DOC_ASSISTANT_EVAL_CASES) {
    assert.equal(ids.has(caseDef.id), false);
    ids.add(caseDef.id);
  }
});

void test("evaluation cases cover ios, web, and no-hit scenarios", () => {
  assert.equal(DOC_ASSISTANT_EVAL_CASES.length >= 20, true);
  assert.equal(
    DOC_ASSISTANT_EVAL_CASES.some((caseDef) =>
      caseDef.expectedPathSuffixes?.some((pathSuffix) => pathSuffix.includes("docs/callsdk-ios/")),
    ),
    true,
  );
  assert.equal(
    DOC_ASSISTANT_EVAL_CASES.some((caseDef) =>
      caseDef.expectedPathSuffixes?.some((pathSuffix) => pathSuffix.includes("docs/callsdk-web/")),
    ),
    true,
  );
  assert.equal(
    DOC_ASSISTANT_EVAL_CASES.some((caseDef) => caseDef.allowNoHits === true),
    true,
  );
  assert.equal(
    DOC_ASSISTANT_EVAL_CASES.some((caseDef) =>
      caseDef.expectedSummaryKeywords?.includes("platform clarification required"),
    ),
    true,
  );
  assert.equal(
    DOC_ASSISTANT_EVAL_CASES.some(
      (caseDef) =>
        caseDef.expectedAnswerKeywords?.includes("步骤") ||
        caseDef.expectedAnswerKeywords?.includes("steps"),
    ),
    true,
  );
  assert.equal(
    DOC_ASSISTANT_EVAL_CASES.some(
      (caseDef) => caseDef.id === "push-notification-language-insufficient",
    ),
    true,
  );
});

void test("evaluateRetrievalCase passes when expected retrieval appears in topK", () => {
  const result = evaluateRetrievalCase({
    caseDef: {
      id: "case",
      title: "title",
      question: "question",
      expectedPathSuffixes: ["docs/callsdk-ios/one-to-one-call.md"],
      discouragedPathSuffixes: ["docs/callsdk-web/one-to-one-call.md"],
      expectedHeadingKeywords: ["start"],
      topK: 2,
    },
    retrieval: [
      {
        path: "docs/callsdk-ios/one-to-one-call.md",
        heading: "Start a 1-to-1 call",
        score: 10,
        startLine: 1,
        endLine: 10,
        snippet: "snippet",
      },
      {
        path: "docs/callsdk-ios/one-to-one-call.md",
        heading: "Receive and accept an incoming call",
        score: 9,
        startLine: 11,
        endLine: 20,
        snippet: "snippet",
      },
    ],
  });

  assert.equal(result.passed, true);
});

void test("evaluateRetrievalCase fails when discouraged retrieval appears in topK", () => {
  const result = evaluateRetrievalCase({
    caseDef: {
      id: "case",
      title: "title",
      question: "question",
      expectedPathSuffixes: ["docs/callsdk-ios/one-to-one-call.md"],
      discouragedPathSuffixes: ["docs/callsdk-web/one-to-one-call.md"],
      topK: 2,
    },
    retrieval: [
      {
        path: "docs/callsdk-web/one-to-one-call.md",
        heading: "Start a call",
        score: 10,
        startLine: 1,
        endLine: 10,
        snippet: "snippet",
      },
      {
        path: "docs/callsdk-ios/one-to-one-call.md",
        heading: "Start a 1-to-1 call",
        score: 9,
        startLine: 11,
        endLine: 20,
        snippet: "snippet",
      },
    ],
  });

  assert.equal(result.passed, false);
  assert.equal(
    result.reasons.some((reason) => reason.includes("Discouraged path")),
    true,
  );
});

void test("evaluateAnswerCase passes when summary and answer match expectations", () => {
  const result = evaluateAnswerCase({
    caseDef: {
      id: "answer-case",
      title: "answer",
      question: "question",
      expectedSummaryKeywords: ["guided answer"],
      expectedAnswerKeywords: ["Steps", "DirectChannel"],
      discouragedAnswerKeywords: ["根据本地文档"],
    },
    answer: 'Steps\n1. Create `DirectChannel("u2")`.',
    summary: "guided answer from 2 documentation chunks",
  });

  assert.equal(result.passed, true);
});

void test("evaluateAnswerCase fails when clarification was expected but answer keywords are missing", () => {
  const result = evaluateAnswerCase({
    caseDef: {
      id: "answer-case",
      title: "answer",
      question: "question",
      expectedSummaryKeywords: ["platform clarification required"],
      expectedAnswerKeywords: ["target platform", "relevant doc entry points"],
    },
    answer: "I will answer for Android first.",
    summary: "guided answer from 2 documentation chunks",
  });

  assert.equal(result.passed, false);
  assert.equal(
    result.reasons.some((reason) => reason.includes("Summary did not include expected keyword")),
    true,
  );
  assert.equal(
    result.reasons.some((reason) => reason.includes("Answer did not include expected keyword")),
    true,
  );
});

void test("evaluateAnswerSurface fails for non-authoritative agent surfaces", () => {
  const result = evaluateAnswerSurface({
    mode: "agent",
    answerSurface: {
      kind: "learning_mock",
      trust: "non_authoritative",
      outputContract: "sentinel_prompt",
      note: "rejected_prompt_scaffolding_output",
    },
  });

  assert.equal(result.passed, false);
  assert.equal(
    result.reasons.some((reason) => reason.includes("non-authoritative surface")),
    true,
  );
});

void test("evaluation layer treats prompt-scaffolding echoes as invalid agent samples", () => {
  const result = evaluateAnswerSurface({
    mode: "agent",
    answerSurface: {
      kind: "openai_compatible",
      trust: "non_authoritative",
      outputContract: "plain_text",
      note: "rejected_prompt_scaffolding_output",
    },
  });

  assert.equal(result.passed, false);
  assert.equal(
    result.reasons.some((reason) => reason.includes("non-authoritative surface")),
    true,
  );
});

void test("evaluateValidationCase fails when validator reports errors", () => {
  const result = evaluateValidationCase({
    validation: {
      ok: false,
      issues: [
        {
          code: "cross_platform",
          severity: "error",
          message: "answer mixes platforms",
        },
      ],
      downgradeTo: "clarification",
    },
  });

  assert.equal(result.passed, false);
  assert.equal(
    result.reasons.some((reason) => reason.includes("cross_platform")),
    true,
  );
});
