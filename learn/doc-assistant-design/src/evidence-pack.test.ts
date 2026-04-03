import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidencePack } from "./evidence-pack.js";
import type { DocSearchHit } from "./protocol/index.js";
import { buildQuestionState } from "./question-state.js";

function makeHit(
  path: string,
  heading: string,
  startLine: number,
  endLine: number,
  snippet: string,
  retrievalBucket: "concept" | "procedural",
): DocSearchHit {
  return {
    path,
    heading,
    startLine,
    endLine,
    snippet,
    text: snippet,
    score: 100,
    retrievalBucket,
  };
}

void test("buildEvidencePack merges adjacent hits from the same page", () => {
  const evidence = buildEvidencePack({
    state: buildQuestionState("How to connect on Android?"),
    hits: [
      makeHit(
        "docs/chatsdk-android/connection/connect.md",
        "Connect",
        1,
        10,
        "initialize sdk",
        "procedural",
      ),
      makeHit(
        "docs/chatsdk-android/connection/connect.md",
        "Connect",
        12,
        20,
        "connect with token",
        "procedural",
      ),
    ],
  });

  assert.equal(evidence.groups.length, 1);
  assert.equal(evidence.groups[0]?.citations.length, 1);
});

void test("buildEvidencePack preserves both definition and task groups for mixed questions", () => {
  const evidence = buildEvidencePack({
    state: buildQuestionState("What is community channel? How to create it?"),
    hits: [
      makeHit(
        "docs/community/overview.md",
        "Overview",
        1,
        10,
        "community channel is a large-scale space",
        "concept",
      ),
      makeHit(
        "docs/community/create.md",
        "Create",
        1,
        10,
        "create a community channel with server api",
        "procedural",
      ),
    ],
  });

  assert.equal(
    evidence.groups.some((group) => group.purpose === "definition"),
    true,
  );
  assert.equal(
    evidence.groups.some((group) => group.purpose === "task_steps"),
    true,
  );
});

void test("buildEvidencePack records trim events when over budget", () => {
  const largeSnippet = "a".repeat(1600);
  const evidence = buildEvidencePack({
    state: buildQuestionState("How to send a message?"),
    hits: [
      makeHit("docs/send.md", "Send", 1, 10, largeSnippet, "procedural"),
      makeHit("docs/setup.md", "Setup", 1, 10, largeSnippet, "procedural"),
    ],
    totalBudgetChars: 1200,
    groupBudgetChars: 500,
  });

  assert.equal(evidence.trimEvents.length > 0, true);
});
