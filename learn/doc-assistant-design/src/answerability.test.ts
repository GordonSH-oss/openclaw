import assert from "node:assert/strict";
import test from "node:test";
import { decideAnswerability } from "./answerability.js";
import type { DocSearchHit } from "./protocol/index.js";
import { buildQuestionState } from "./question-state.js";

function makeHit(overrides: Partial<DocSearchHit> = {}): DocSearchHit {
  return {
    path: "docs/chatsdk-android/push/example.md",
    heading: "Example",
    startLine: 1,
    endLine: 10,
    snippet: "Example snippet",
    score: 100,
    text: "Example text",
    ...overrides,
  };
}

void test("decideAnswerability rejects push-language evidence without default-language coverage", () => {
  const decision = decideAnswerability({
    question: "How to change the default language for push notification?",
    hits: [
      makeHit({
        path: "docs/chatsdk-android/push/handle-push-notification-click.md",
        heading: "Handle push notification click",
        text: "Use PushMessageReceiver to open the right conversation after the user taps a push notification.",
      }),
      makeHit({
        path: "docs/chatsdk-android/push/config-push-notification-style.md",
        heading: "Configure push style",
        text: "Customize icons, channels, and click handling for Android push notifications.",
      }),
    ],
  });

  assert.equal(decision.verdict, "insufficient_evidence");
  assert.equal(decision.reason?.includes("language"), true);
});

void test("decideAnswerability rejects concept answers when the referent never appears in evidence", () => {
  const decision = decideAnswerability({
    question: "What is Nexconn?",
    hits: [
      makeHit({
        path: "docs/chatsdk-android/group-channels/overview.md",
        heading: "Group channel overview",
        text: "Group channels support member management, muting, and message history sync.",
      }),
    ],
  });

  assert.equal(decision.verdict, "insufficient_evidence");
  assert.equal(decision.reason, "retrieved evidence is missing required anchors: nexconn");
});

void test("decideAnswerability treats partial-only matches as insufficient evidence", () => {
  const decision = decideAnswerability({
    question: "How to change the default language for push notification?",
    hits: [
      makeHit({
        path: "docs/partials/im/shared/ios-push/_config-by-app-user.md",
        heading: "Set the user's push notification language preference",
        text: "Set the user's push notification language preference.",
      }),
    ],
  });

  assert.equal(decision.verdict, "insufficient_evidence");
  assert.equal(decision.reason, "only non-authoritative partial documentation was retrieved");
});

void test("decideAnswerability rejects metadata-only procedural evidence", () => {
  const question = "How to start a direct chat on iOS?";
  const decision = decideAnswerability({
    question,
    state: buildQuestionState(question),
    hits: [
      makeHit({
        path: "docs/chatsdk-ios/connection/connect.md",
        heading: "Connection status codes",
        text: "Connection status codes for iOS chat clients.",
      }),
    ],
  });

  assert.equal(decision.verdict, "insufficient_evidence");
  assert.equal(
    decision.reason,
    "retrieved evidence is missing required anchors: channel, direct channel",
  );
});

void test("decideAnswerability rejects broad server integration answers without a narrower task focus", () => {
  const question = "How to integrate using Server API?";
  const decision = decideAnswerability({
    question,
    state: buildQuestionState(question),
    hits: [
      makeHit({
        path: "docs/platform-chat-api/chat-server-api-list.md",
        heading: "Default behaviors",
        text: "Use the Server API from your app server to send messages and manage users.",
      }),
      makeHit({
        path: "docs/platform-chat-api/chat-server-api-list.md",
        heading: "User blocklist",
        text: "Add and remove users from the blocklist with Server API endpoints.",
      }),
    ],
  });

  assert.equal(decision.verdict, "insufficient_evidence");
  assert.equal(decision.reason, "server api integration request still needs a narrower task focus");
});
