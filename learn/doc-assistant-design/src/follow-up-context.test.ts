import assert from "node:assert/strict";
import test from "node:test";
import {
  detectClarificationFollowUpQuestion,
  detectContextualFollowUpQuestion,
  extractQuestionStatePatchFromFollowUp,
  isStoredClarificationFollowUpAllowed,
  rewriteContextualFollowUpQuestion,
  rewriteTaskFocusClarificationQuestion,
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
    product: "server",
  });
  assert.deepEqual(detectClarificationFollowUpQuestion("client SDK"), {
    apiLayer: "client",
  });
});

void test("detectClarificationFollowUpQuestion accepts short task-focus replies", () => {
  assert.deepEqual(detectClarificationFollowUpQuestion("webhook signature verification"), {
    taskFocus: "webhook signature verification",
  });
});

void test("detectContextualFollowUpQuestion accepts dependent code-snippet requests", () => {
  assert.deepEqual(detectContextualFollowUpQuestion("Can you give me a code snippet about it?"), {
    responseStyle: "code_snippet",
  });
  assert.deepEqual(detectContextualFollowUpQuestion("Can you give me a code snippet?"), {
    responseStyle: "code_snippet",
  });
  assert.equal(
    detectContextualFollowUpQuestion(
      "Can you give me a code snippet for pinning a channel on iOS?",
    ),
    null,
  );
});

void test("extractQuestionStatePatchFromFollowUp returns a mergeable state patch", () => {
  assert.deepEqual(extractQuestionStatePatchFromFollowUp("group channel"), {
    channelKind: "group",
  });
  assert.deepEqual(extractQuestionStatePatchFromFollowUp("Server API"), {
    apiLayer: "server",
  });
  assert.deepEqual(extractQuestionStatePatchFromFollowUp("Server API", "product"), {
    product: "server",
  });
  assert.equal(extractQuestionStatePatchFromFollowUp("Android 怎么初始化 Chat SDK？"), null);
});

void test("isStoredClarificationFollowUpAllowed accepts any recognized platform follow-up", () => {
  assert.equal(
    isStoredClarificationFollowUpAllowed(
      {
        clarificationKind: "platform",
        candidatePlatforms: ["android", "flutter"],
      },
      { platform: "android" },
    ),
    true,
  );
  assert.equal(
    isStoredClarificationFollowUpAllowed(
      {
        clarificationKind: "platform",
        candidatePlatforms: ["android", "flutter"],
      },
      { platform: "web" },
    ),
    true,
  );
  assert.equal(
    isStoredClarificationFollowUpAllowed(
      {
        clarificationKind: "channel_kind",
        candidatePlatforms: [],
      },
      { channelKind: "group" },
    ),
    true,
  );
  assert.equal(
    isStoredClarificationFollowUpAllowed(
      {
        clarificationKind: "api_layer",
        candidatePlatforms: [],
      },
      { platform: "android" },
    ),
    false,
  );
  assert.equal(
    isStoredClarificationFollowUpAllowed(
      {
        clarificationKind: "task_focus",
        candidatePlatforms: [],
      },
      { taskFocus: "webhook signature verification" },
    ),
    true,
  );
});

void test("rewriteTaskFocusClarificationQuestion appends the narrowed task focus", () => {
  assert.equal(
    rewriteTaskFocusClarificationQuestion(
      "How to integrate using Server API?",
      "webhook signature verification",
    ),
    "How to integrate using Server API for webhook signature verification?",
  );
});

void test("rewriteContextualFollowUpQuestion appends the presentation request to the resolved question", () => {
  assert.equal(
    rewriteContextualFollowUpQuestion("How to pin a channel on iOS?", {
      responseStyle: "code_snippet",
    }),
    "How to pin a channel on iOS Show a code snippet.",
  );
});
