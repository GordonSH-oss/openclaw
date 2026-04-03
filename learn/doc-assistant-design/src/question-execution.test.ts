import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { updateClarificationStateAfterAnswer } from "./follow-up-context.js";
import { executeDocQuestion } from "./question-execution.js";

async function makeTempDir(name: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function createConnectClarificationDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-connect-clarify");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-android", "connection"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "platform-chat-api", "connection"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-android", "connection", "connect.md"),
    [
      "# Connect",
      "",
      "Use the Android Chat SDK client to connect the current user with an access token.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "platform-chat-api", "connection", "connect.md"),
    [
      "# Connect with Server API",
      "",
      "Use the Server API endpoint from your app server to manage connection-related server behavior.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createPushLanguagePartialOnlyDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-push-language-partial");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-android", "push"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "partials", "im", "shared", "ios-push"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-android", "push", "handle-push-notification-click.md"),
    [
      "# Handle push notification click",
      "",
      "Use PushMessageReceiver to open the target conversation page from a notification click.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "partials", "im", "shared", "ios-push", "_config-by-app-user.md"),
    [
      "# Set the user's push notification language preference",
      "",
      "Set the user's push notification language preference.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createOffIntentQuickstartDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-off-intent-quickstart");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-ios"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-flutter"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "quickstart.md"),
    [
      "# Quickstart",
      "",
      "## Step 4: Connect to the server",
      "",
      "Connect the iOS Chat SDK user with an access token.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-flutter", "quickstart.md"),
    [
      "# Quickstart",
      "",
      "## Initialize the Chat SDK",
      "",
      "Initialize the Flutter Chat SDK before connecting.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createCommunityChatFollowUpDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-community-chat-followup");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-ios", "community-channels"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-ios"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "community-channels", "overview.md"),
    [
      "# Community channel overview",
      "",
      "A community channel provides a multi-user chat experience with no member limit.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "quickstart.md"),
    [
      "# Quickstart",
      "",
      "## Step 5: Send a message",
      "",
      'Create `DirectChannel("userId")`, then build `SendTextMessageParams` and call `channel.sendMessage(...)`.',
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createDirectChannelPlatformClarificationDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-direct-channel-platform-clarify");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-android", "direct-system-channels"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-flutter", "direct-system-channels"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-android", "direct-system-channels", "overview.md"),
    [
      "# Direct channel overview",
      "",
      "A direct channel starts a one-to-one chat on Android.",
      "",
      "## Create a channel instance",
      "",
      'Create `DirectChannel("userId")` as the Android direct channel instance.',
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(
      docsRoot,
      "docs",
      "chatsdk-android",
      "direct-system-channels",
      "retrieving-channels.md",
    ),
    [
      "# Get a specific channel",
      "",
      'Construct `DirectChannel("userId")` and call `reload()` on Android.',
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-flutter", "direct-system-channels", "overview.md"),
    [
      "# Direct channel overview",
      "",
      "A direct channel starts a one-to-one chat in Flutter.",
      "",
      "## Direct channel",
      "",
      "The SDK creates and maintains the direct channel relationship in Flutter.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createWebDirectChannelSendOnlyDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-web-direct-channel-send-only");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-web", "message"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-web", "message", "send.md"),
    [
      "# Send a text message",
      "",
      "```ts",
      "import { DirectChannel, SendTextMessageParams } from '@nexconn/chat';",
      "const channel = new DirectChannel('<target-user-id>');",
      "const params = new SendTextMessageParams({ text: 'Hello!' });",
      "const result = await channel.sendMessage(params);",
      "```",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

void test("executeDocQuestion asks for api layer clarification before answering generic connect questions", async () => {
  const docsRoot = await createConnectClarificationDocs();
  const result = await executeDocQuestion({
    runId: "connect-clarify-1",
    question: "How to connect?",
    mode: "extractive",
    docsRoot,
    maxResults: 4,
  });

  assert.equal(result.route, "search");
  assert.equal(result.answer.summary, "api layer clarification required");
  assert.equal(result.answer.answer.includes("client SDK"), true);
  assert.equal(result.answer.answer.includes("Server API"), true);
});

void test("api layer clarification follow-up rewrites the question and continues", async () => {
  const docsRoot = await createConnectClarificationDocs();
  const dataDir = await makeTempDir("doc-assistant-connect-followup");
  const sessionId = "connect-followup-session";

  const first = await executeDocQuestion({
    runId: "connect-clarify-2",
    question: "How to connect?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 4,
  });

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "connect-clarify-2",
    question: "How to connect?",
    hits: first.hits,
    summary: first.answer.summary,
    pendingQuestion: first.answer.pendingClarificationQuestion,
    clarificationKind: first.answer.pendingClarificationKind,
    clarificationHits: first.answer.clarificationHits,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "connect-clarify-3",
    question: "Server API",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 4,
  });

  assert.equal(second.answer.followUpSource, "clarification_rewrite");
  assert.equal(second.answer.rewrittenQuestion, "How to connect using Server API?");
  assert.notEqual(second.answer.summary, "api layer clarification required");
});

void test("executeDocQuestion treats partial-only push language matches as insufficient evidence", async () => {
  const docsRoot = await createPushLanguagePartialOnlyDocs();
  const result = await executeDocQuestion({
    runId: "push-language-partial-1",
    question: "How to change the default language for push notification?",
    mode: "extractive",
    docsRoot,
    maxResults: 5,
  });

  assert.equal(result.answer.summary, "insufficient documentation evidence");
  assert.equal(result.answer.answer.toLowerCase().includes("enough evidence"), true);
});

void test("executeDocQuestion does not expand off-intent infra questions into SDK quickstarts", async () => {
  const docsRoot = await createOffIntentQuickstartDocs();
  const result = await executeDocQuestion({
    runId: "off-intent-kubernetes-1",
    question: "How do I configure Kubernetes liveness probes for this SDK?",
    mode: "extractive",
    docsRoot,
    maxResults: 5,
  });

  assert.equal(result.hits.length, 0);
  assert.equal(result.answer.summary, "no relevant documentation found");
});

void test("community chat follow-up does not drift into direct-chat steps", async () => {
  const docsRoot = await createCommunityChatFollowUpDocs();
  const dataDir = await makeTempDir("doc-assistant-community-chat-followup");
  const sessionId = "community-chat-followup-session";

  const first = await executeDocQuestion({
    runId: "community-chat-followup-1",
    question: "How to start a community chat?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "community-chat-followup-1",
    question: "How to start a community chat?",
    hits: first.hits,
    summary: first.answer.summary,
    pendingQuestion: first.answer.pendingClarificationQuestion,
    clarificationKind: first.answer.pendingClarificationKind,
    clarificationHits: first.answer.clarificationHits,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "community-chat-followup-2",
    question: "iOS",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(second.answer.summary.includes("direct"), false);
  assert.equal(second.answer.answer.includes("DirectChannel"), false);
  assert.equal(second.answer.answer.toLowerCase().includes("community channel"), true);
});

void test("invalid platform follow-up re-asks for a supported platform and keeps the clarification context usable", async () => {
  const docsRoot = await createDirectChannelPlatformClarificationDocs();
  const dataDir = await makeTempDir("doc-assistant-invalid-platform-followup");
  const sessionId = "invalid-platform-followup-session";

  const first = await executeDocQuestion({
    runId: "invalid-platform-followup-1",
    question: "How to create a direct channel?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(first.answer.summary, "platform clarification required");
  assert.equal(first.answer.answer.includes("Android / Flutter"), true);

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "invalid-platform-followup-1",
    question: "How to create a direct channel?",
    hits: first.hits,
    summary: first.answer.summary,
    pendingQuestion: first.answer.pendingClarificationQuestion,
    clarificationKind: first.answer.pendingClarificationKind,
    clarificationHits: first.answer.clarificationHits,
    route: first.route,
    dataDir,
  });

  const invalid = await executeDocQuestion({
    runId: "invalid-platform-followup-2",
    question: "Web",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(invalid.answer.summary, "platform clarification required");
  assert.equal(invalid.answer.answer.includes("Android / Flutter"), true);
  assert.equal(Boolean(invalid.answer.followUpSource), false);
  assert.equal(Boolean(invalid.answer.rewrittenQuestion), false);

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "invalid-platform-followup-2",
    question: "Web",
    hits: invalid.hits,
    summary: invalid.answer.summary,
    pendingQuestion: invalid.answer.pendingClarificationQuestion,
    clarificationKind: invalid.answer.pendingClarificationKind,
    clarificationHits: invalid.answer.clarificationHits,
    route: invalid.route,
    dataDir,
  });

  const valid = await executeDocQuestion({
    runId: "invalid-platform-followup-3",
    question: "Android",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(Boolean(valid.answer.followUpSource), true);
  assert.equal(valid.answer.rewrittenQuestion, "How to create a direct channel on Android?");
  assert.equal(valid.answer.summary.includes("clarification"), false);
});

void test("direct-channel creation on Web does not collapse into a send-message answer kind", async () => {
  const docsRoot = await createWebDirectChannelSendOnlyDocs();
  const result = await executeDocQuestion({
    runId: "web-direct-channel-creation-1",
    question: "How to create a direct channel on Web?",
    mode: "extractive",
    docsRoot,
    maxResults: 5,
  });

  assert.equal(result.answer.summary.includes("send"), false);
  assert.equal(result.answer.answer.includes("start a direct chat on Web"), true);
  assert.equal(result.answer.answer.includes("send a message on Web"), false);
  assert.equal(result.answer.answer.includes("DirectChannel"), true);
});
