import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQuestionState,
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
  assert.equal(state.taskKind, "channel_creation");
  assert.equal(state.channelKind, undefined);
  assert.equal(state.ambiguity.missingChannelKind, true);
});

void test("buildQuestionState marks generic connect questions as missing api layer", () => {
  const state = buildQuestionState("How to connect?");
  assert.equal(state.intent, "procedural");
  assert.equal(state.apiLayer, undefined);
  assert.equal(state.ambiguity.missingApiLayer, true);
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
