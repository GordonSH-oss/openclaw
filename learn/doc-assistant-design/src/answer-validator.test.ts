import assert from "node:assert/strict";
import test from "node:test";
import { validateAnswer } from "./answer-validator.js";
import { buildEvidencePack } from "./evidence-pack.js";
import type { DocSearchHit } from "./protocol/index.js";
import { buildQuestionState } from "./question-state.js";

function makeHit(
  path: string,
  heading: string,
  snippet: string,
  retrievalBucket: "concept" | "procedural",
): DocSearchHit {
  return {
    path,
    heading,
    startLine: 1,
    endLine: 10,
    snippet,
    text: snippet,
    score: 100,
    retrievalBucket,
  };
}

void test("validateAnswer flags missing clarification for generic connect questions", () => {
  const state = buildQuestionState("How to connect?");
  const evidence = buildEvidencePack({
    state,
    hits: [
      makeHit(
        "docs/chatsdk-android/connection/connect.md",
        "Connect",
        "client sdk connect",
        "procedural",
      ),
    ],
  });
  const result = validateAnswer({
    question: state.rawQuestion,
    state,
    evidence,
    answer: "Steps\n1. Call connect.",
    summary: "guided answer from 1 documentation chunks",
    citations: evidence.groups[0]?.citations ?? [],
  });

  assert.equal(result.downgradeTo, "clarification");
  assert.equal(
    result.issues.some((issue) => issue.code === "missing_clarification"),
    true,
  );
});

void test("validateAnswer flags cross platform answers", () => {
  const state = buildQuestionState("How to send a message on Android?");
  const evidence = buildEvidencePack({
    state,
    hits: [
      makeHit("docs/chatsdk-android/message/send.md", "Send", "android send message", "procedural"),
    ],
  });
  const result = validateAnswer({
    question: state.rawQuestion,
    state,
    evidence,
    answer: "Use the iOS SDK to send the message.",
    summary: "guided answer from 1 documentation chunks",
    citations: evidence.groups[0]?.citations ?? [],
  });

  assert.equal(result.downgradeTo, "clarification");
  assert.equal(
    result.issues.some((issue) => issue.code === "cross_platform"),
    true,
  );
});

void test("validateAnswer downgrades unsupported intent to insufficient", () => {
  const state = buildQuestionState("How to change the default language for push notification?");
  const evidence = buildEvidencePack({
    state,
    hits: [
      makeHit(
        "docs/chatsdk-android/push/handle-push-notification-click.md",
        "Use PushMessageReceiver",
        "configure notification click intent filter",
        "procedural",
      ),
    ],
  });
  const result = validateAnswer({
    question: state.rawQuestion,
    state,
    evidence,
    answer: "Set the language in the click handler.",
    summary: "guided answer from 1 documentation chunks",
    citations: evidence.groups[0]?.citations ?? [],
  });

  assert.equal(result.downgradeTo, "insufficient");
  assert.equal(
    result.issues.some((issue) => issue.code === "off_intent_answer"),
    true,
  );
});

void test("validateAnswer does not require referent coverage for ordinary procedural questions", () => {
  const state = buildQuestionState("How do I check my Node version?");
  const evidence = buildEvidencePack({
    state,
    hits: [
      makeHit(
        "docs/install/node.md",
        "Check your version",
        "Run `node --version` to check your current Node version.",
        "procedural",
      ),
    ],
  });
  const result = validateAnswer({
    question: state.rawQuestion,
    state,
    evidence,
    answer: "Run `node --version` to check your current Node version.",
    summary: "guided answer from 1 documentation chunks",
    citations: evidence.groups[0]?.citations ?? [],
  });

  assert.equal(
    result.issues.some((issue) => issue.code === "citation_topic_mismatch"),
    false,
  );
  assert.equal(result.ok, true);
});

void test("validateAnswer downgrades procedural answers when action and object only match across unrelated citations", () => {
  const state = buildQuestionState("How to create a user?");
  const evidence = buildEvidencePack({
    state,
    hits: [
      makeHit(
        "docs/platform-chat-api/community-channel/usergroup/add-user-to-usergroup.md",
        "Request body",
        "Add a user to a community channel user group through this request body.",
        "procedural",
      ),
      makeHit(
        "docs/chatsdk-ios/group-channels/manage-group-channel.md",
        "Create a group",
        "Call GroupChannel.createGroup(params:completion:) to create a new group.",
        "procedural",
      ),
    ],
  });
  const result = validateAnswer({
    question: state.rawQuestion,
    state,
    evidence,
    answer: "Steps\n1. Call GroupChannel.createGroup(params:completion:) to create a new group.",
    summary: "guided answer from 2 documentation chunks",
    citations: evidence.groups.flatMap((group) => group.citations),
  });

  assert.equal(result.downgradeTo, "insufficient");
  assert.equal(
    result.issues.some((issue) => issue.code === "off_intent_answer"),
    true,
  );
});

void test("validateAnswer downgrades answers that turn status metadata into steps", () => {
  const state = buildQuestionState("How to start a direct chat on iOS?");
  const evidence = buildEvidencePack({
    state,
    hits: [
      makeHit(
        "docs/chatsdk-ios/connection/connect.md",
        "Connection status codes",
        "Connection status codes for iOS chat clients.",
        "procedural",
      ),
    ],
  });
  const result = validateAnswer({
    question: state.rawQuestion,
    state,
    evidence,
    answer: "Steps\n- Complete this step as documented in Connection status codes.",
    summary: "guided answer from 1 documentation chunks",
    citations: evidence.groups[0]?.citations ?? [],
  });

  assert.equal(result.downgradeTo, "insufficient");
  assert.equal(
    result.issues.some((issue) => issue.code === "section_mismatch"),
    true,
  );
});

void test("validateAnswer downgrades procedural answers that have no actionable step", () => {
  const state = buildQuestionState("How to recall a message in web?");
  const evidence = buildEvidencePack({
    state,
    hits: [
      makeHit(
        "docs/chatsdk-web/message/recall.md",
        "Delete a message",
        "Call BaseChannel.createMessagesQuery(...) and channel.deleteMessageForAll(message).",
        "procedural",
      ),
    ],
  });
  const result = validateAnswer({
    question: state.rawQuestion,
    state,
    evidence,
    answer: "Use the documented flow below.",
    summary: "guided answer from 1 documentation chunks",
    citations: evidence.groups[0]?.citations ?? [],
  });

  assert.equal(result.downgradeTo, "insufficient");
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.code === "off_intent_answer" && issue.message.includes("actionable documented step"),
    ),
    true,
  );
});
