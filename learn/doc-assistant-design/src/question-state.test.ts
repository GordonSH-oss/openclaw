import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQuestionState,
  detectQuestionProduct,
  mergeQuestionState,
  rewriteQuestionFromState,
} from "./question-state.js";

void test("buildQuestionState detects concept/community questions", () => {
  const state = buildQuestionState("What is community channel?");
  assert.equal(state.language, "en");
  assert.equal(state.intent, "concept");
  assert.equal(state.channelKind, "community");
  assert.equal(state.referent, "community channel");
  assert.equal(state.ambiguity.missingPlatform, false);
});

void test("buildQuestionState detects Chinese concept questions", () => {
  const state = buildQuestionState("什么是 community channel？");
  assert.equal(state.language, "zh");
  assert.equal(state.intent, "concept");
  assert.equal(state.channelKind, "community");
  assert.equal(state.apiLayer, undefined);
});

void test("buildQuestionState normalizes community chat into community channel", () => {
  const state = buildQuestionState("How to start a community chat?");
  assert.equal(state.intent, "procedural");
  assert.equal(state.channelKind, "community");
  assert.equal(state.referent, "community channel");
});

void test("buildQuestionState marks generic channel creation as missing channel kind", () => {
  const state = buildQuestionState("How to create a channel?");
  assert.equal(state.intent, "procedural");
  assert.equal(state.heuristicHints?.taskKind, "channel_creation");
  assert.equal(state.channelKind, undefined);
  assert.equal(state.ambiguity.missingChannelKind, true);
});

void test("buildQuestionState marks generic connect questions as missing api layer", () => {
  const state = buildQuestionState("How to connect?");
  assert.equal(state.intent, "procedural");
  assert.equal(state.apiLayer, undefined);
  assert.equal(state.ambiguity.missingApiLayer, true);
});

void test("buildQuestionState marks generic integration questions as missing product", () => {
  const state = buildQuestionState("How to integrate?");
  assert.equal(state.intent, "procedural");
  assert.equal(state.product, undefined);
  assert.equal(state.ambiguity.missingProduct, true);
  assert.equal(state.anchors.verbPhrases.includes("integrate"), true);
});

void test("buildQuestionState marks generic get-started questions as missing product", () => {
  const state = buildQuestionState("How can I get started?");
  assert.equal(state.intent, "procedural");
  assert.equal(state.product, undefined);
  assert.equal(state.ambiguity.missingProduct, true);
  assert.equal(state.heuristicHints?.taskKind, "generic");
});

void test("buildQuestionState does not invent procedural referents from the full sentence", () => {
  const state = buildQuestionState("How do I check my Node version?");
  assert.equal(state.intent, "procedural");
  assert.equal(state.referent, undefined);
});

void test("buildQuestionState does not force api layer for concept channel questions", () => {
  const state = buildQuestionState("What is community channel?");
  assert.equal(state.intent, "concept");
  assert.equal(state.apiLayer, undefined);
});

void test("buildQuestionState treats connect to the chat server as a platform question, not api-layer ambiguity", () => {
  const state = buildQuestionState("How to connect to the chat server?");
  assert.equal(state.ambiguity.missingPlatform, true);
  assert.equal(state.ambiguity.missingApiLayer, false);
});

void test("buildQuestionState keeps mixed referents", () => {
  const state = buildQuestionState("What is community channel? How to create it?");
  assert.equal(state.intent, "mixed");
  assert.equal(state.referent, "community channel");
});

void test("buildQuestionState extracts anchors for recall questions", () => {
  const state = buildQuestionState("How to recall a message in web?");
  assert.equal(state.intent, "procedural");
  assert.equal(state.platform, "web");
  assert.equal(state.anchors.verbPhrases.includes("recall"), true);
  assert.equal(state.anchors.nounPhrases.includes("message"), true);
  assert.equal(state.heuristicHints?.messageSubtype, "generic");
});

void test("buildQuestionState canonicalizes self-only message deletion qualifiers", () => {
  const state = buildQuestionState("How to delete message for myself on Web?");
  assert.equal(state.platform, "web");
  assert.equal(state.anchors.qualifiers.includes("for self only"), true);
  assert.equal(state.anchors.unknownTerms.includes("myself"), false);
});

void test("buildQuestionState keeps unseen task anchors instead of collapsing them away", () => {
  const state = buildQuestionState("How to verify webhook signature permissions in a thread?");
  assert.equal(state.anchors.verbPhrases.includes("verify"), true);
  assert.equal(state.anchors.nounPhrases.includes("webhook signature"), true);
  assert.equal(state.anchors.nounPhrases.includes("permission"), true);
  assert.equal(state.anchors.nounPhrases.includes("message thread"), true);
});

void test("buildQuestionState extracts Chinese unseen task anchors", () => {
  const state = buildQuestionState("如何在话题中设置提及权限并校验 webhook 签名？");
  assert.equal(state.anchors.verbPhrases.includes("verify"), true);
  assert.equal(state.anchors.nounPhrases.includes("message thread"), true);
  assert.equal(state.anchors.nounPhrases.includes("mention"), true);
  assert.equal(state.anchors.nounPhrases.includes("permission"), true);
});

void test("buildQuestionState treats token auth as a concrete server-task anchor", () => {
  const state = buildQuestionState("How to integrate using Server API for token/auth?");
  assert.equal(state.anchors.verbPhrases.includes("integrate"), true);
  assert.equal(state.anchors.nounPhrases.includes("access token"), true);
  assert.equal(state.ambiguity.missingProduct, false);
});

void test("buildQuestionState keeps open-set server focus terms like blocklist", () => {
  const state = buildQuestionState("How to integrate using Server API for blocklist management?");
  assert.equal(state.anchors.unknownTerms.includes("blocklist"), true);
  assert.equal(state.anchors.unknownTerms.includes("management"), true);
});

void test("detectQuestionProduct does not mistake SDK method-call prose for Call SDK", () => {
  assert.equal(
    detectQuestionProduct(
      "Build SendTextMessageParams and call channel.sendMessage(...) to send a text message on Android.",
    ),
    "chat",
  );
  assert.equal(
    detectQuestionProduct(
      'Create OpenChannel(channelId: "channelId"), then call exitChannel(...) to leave it.',
    ),
    "chat",
  );
  assert.equal(detectQuestionProduct("How to start a one-to-one call on iOS?"), "call");
});

void test("buildQuestionState keeps Call SDK one-to-one questions out of direct-channel chat semantics", () => {
  const state = buildQuestionState("How do I start or accept a 1-to-1 call in the iOS Call SDK?");
  assert.equal(state.product, "call");
  assert.equal(state.channelKind, undefined);
  assert.equal(state.anchors.nounPhrases.includes("call"), true);
  assert.equal(state.anchors.nounPhrases.includes("direct channel"), false);
  assert.equal(state.heuristicHints?.taskKind, "generic");
});

void test("rewriteQuestionFromState merges follow-up slots back into the question", () => {
  const base = buildQuestionState("How to create a channel?");
  const merged = mergeQuestionState(base, {
    platform: "android",
    channelKind: "group",
  });
  assert.equal(rewriteQuestionFromState(merged), "How to create a group channel on Android?");
});

void test("rewriteQuestionFromState can append api layer clarification", () => {
  const base = buildQuestionState("How to connect?");
  const merged = mergeQuestionState(base, {
    apiLayer: "server",
  });
  assert.equal(rewriteQuestionFromState(merged), "How to connect using Server API?");
});

void test("rewriteQuestionFromState can append product clarification", () => {
  const base = buildQuestionState("How to integrate?");
  const merged = mergeQuestionState(base, {
    product: "chat",
  });
  assert.equal(rewriteQuestionFromState(merged), "How to integrate for Chat SDK?");
});
