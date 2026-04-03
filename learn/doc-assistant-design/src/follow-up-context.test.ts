import assert from "node:assert/strict";
import test from "node:test";
import {
  detectClarificationFollowUpQuestion,
  extractQuestionStatePatchFromFollowUp,
} from "./follow-up-context.js";

void test("detectClarificationFollowUpQuestion still accepts short platform-only replies", () => {
  assert.deepEqual(detectClarificationFollowUpQuestion("Android"), { platform: "android" });
  assert.deepEqual(detectClarificationFollowUpQuestion("我要找android的"), {
    platform: "android",
  });
});

void test("detectClarificationFollowUpQuestion accepts short channel-kind replies", () => {
  assert.deepEqual(detectClarificationFollowUpQuestion("group channel"), {
    channelKind: "group",
  });
  assert.deepEqual(detectClarificationFollowUpQuestion("community"), {
    channelKind: "community",
  });
});

void test("detectClarificationFollowUpQuestion accepts short api-layer replies", () => {
  assert.deepEqual(detectClarificationFollowUpQuestion("Server API"), {
    apiLayer: "server",
  });
  assert.deepEqual(detectClarificationFollowUpQuestion("client SDK"), {
    apiLayer: "client",
  });
});

void test("extractQuestionStatePatchFromFollowUp returns a mergeable state patch", () => {
  assert.deepEqual(extractQuestionStatePatchFromFollowUp("group channel"), {
    channelKind: "group",
  });
  assert.deepEqual(extractQuestionStatePatchFromFollowUp("Server API"), {
    apiLayer: "server",
  });
  assert.equal(extractQuestionStatePatchFromFollowUp("Android 怎么初始化 Chat SDK？"), null);
});
