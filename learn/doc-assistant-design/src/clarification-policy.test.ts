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
