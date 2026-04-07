import assert from "node:assert/strict";
import test from "node:test";
import { decideClarification } from "./clarification-policy.js";
import type { DocSearchHit } from "./protocol/index.js";
import { buildQuestionState } from "./question-state.js";

function makeHit(path: string, heading: string, text: string, score = 100): DocSearchHit {
  return {
    path,
    heading,
    startLine: 1,
    endLine: 5,
    snippet: text,
    text,
    score,
  };
}

void test("decideClarification asks for platform when SDK hits span multiple platforms", () => {
  const decision = decideClarification({
    state: buildQuestionState("How to start a direct chat?"),
    hits: [
      makeHit("docs/chatsdk-android/quickstart.md", "Quickstart", "Android direct channel"),
      makeHit("docs/chatsdk-ios/quickstart.md", "Quickstart", "iOS direct channel"),
    ],
  });

  assert.equal(decision.shouldClarify, true);
  assert.equal(decision.kind, "platform");
});

void test("decideClarification asks for channel kind when channel creation hits diverge", () => {
  const decision = decideClarification({
    state: buildQuestionState("How to create a channel?"),
    hits: [
      makeHit("docs/chatsdk-ios/group-channels/create.md", "Create a group", "group channel"),
      makeHit(
        "docs/chatsdk-android/direct-system-channels/retrieving-channels.md",
        "Retrieving channels",
        "direct channel",
      ),
    ],
  });

  assert.equal(decision.shouldClarify, true);
  assert.equal(decision.kind, "channel_kind");
});

void test("decideClarification asks for api layer on generic connect questions", () => {
  const decision = decideClarification({
    state: buildQuestionState("How to connect?"),
    hits: [makeHit("docs/chatsdk-android/connection/connect.md", "Connect", "client sdk connect")],
  });

  assert.equal(decision.shouldClarify, true);
  assert.equal(decision.kind, "api_layer");
});

void test("decideClarification asks for product on generic integration questions", () => {
  const decision = decideClarification({
    state: buildQuestionState("How to integrate?"),
    hits: [
      makeHit("docs/chatsdk-web/getting-started.md", "Integrate Chat SDK", "web chat sdk"),
      makeHit("docs/callsdk-web/quickstart.md", "Integrate Call SDK", "web call sdk"),
    ],
  });

  assert.equal(decision.shouldClarify, true);
  assert.equal(decision.kind, "product");
});

void test("decideClarification asks for task focus on broad server integration questions", () => {
  const decision = decideClarification({
    state: buildQuestionState("How to integrate using Server API?"),
    hits: [
      makeHit(
        "docs/platform-chat-api/chat-server-api-list.md",
        "Default behaviors",
        "The Platform Chat API lets your app server send messages and manage user state.",
      ),
      makeHit(
        "docs/platform-chat-api/chat-server-api-list.md",
        "User blocklist",
        "Add to blocklist and remove from blocklist with Server API endpoints.",
      ),
    ],
  });

  assert.equal(decision.shouldClarify, true);
  assert.equal(decision.kind, "task_focus");
  assert.equal(decision.candidateOptions?.includes("blocklist"), true);
  assert.equal(decision.candidateOptions?.includes("specific endpoint"), false);
});

void test("decideClarification derives token focus only when evidence mentions token docs", () => {
  const decision = decideClarification({
    state: buildQuestionState("How to integrate using Server API?"),
    hits: [
      makeHit(
        "docs/platform-chat-api/user/register.md",
        "Issue an access token",
        "Use the Server API endpoint to issue an access token for the user.",
      ),
      makeHit(
        "docs/platform-chat-api/webhook/signature-verification.md",
        "Verify the webhook signature",
        "Read the signature header and verify the webhook signature before you accept the callback.",
      ),
    ],
  });

  assert.equal(decision.shouldClarify, true);
  assert.equal(decision.kind, "task_focus");
  assert.equal(decision.candidateOptions?.includes("access token"), true);
  assert.equal(decision.candidateOptions?.includes("webhook signature verification"), true);
});
