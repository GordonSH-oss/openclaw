import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskFrame, labelEvidenceHit } from "./task-frame.js";

void test("buildTaskFrame derives a procedural recall frame from the question state", () => {
  const frame = buildTaskFrame({
    question: "How to recall a message in web?",
  });

  assert.equal(frame.responseMode, "procedure");
  assert.equal(frame.platform, "web");
  assert.equal(frame.anchors.verbs.includes("recall"), true);
  assert.equal(frame.anchors.focus.includes("message"), true);
  assert.equal(frame.coverage, undefined);
});

void test("labelEvidenceHit captures recall actions and events separately", () => {
  const actionHit = labelEvidenceHit({
    path: "docs/chatsdk-web/message/recall.md",
    heading: "Delete a message",
    text: "Call BaseChannel.createMessagesQuery(...) and channel.deleteMessageForAll(message).",
  });
  assert.equal(actionHit.labels.includes("procedure"), true);
  assert.equal(actionHit.anchors.nounPhrases.includes("message"), true);

  const eventHit = labelEvidenceHit({
    path: "docs/chatsdk-web/message/recall.md",
    heading: "Handle deletion notifications",
    text: "Register MessageHandler and handle onMessageDeleted to update the UI.",
  });
  assert.equal(eventHit.labels.includes("event"), true);
  assert.equal(eventHit.anchors.nounPhrases.includes("message"), true);
});
