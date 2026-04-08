import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { replaceAnswerMemoryEntries } from "./answer-memory.js";
import { updateConversationStateAfterAnswer } from "./conversation-context.js";
import { renderClarificationAnswer } from "./doc-answer.js";
import { searchDocs } from "./doc-search.js";
import { updateClarificationStateAfterAnswer } from "./follow-up-context.js";
import { executeDocQuestion } from "./question-execution.js";
import { saveRetrievalMemoryEntries } from "./retrieval-memory.js";

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

async function createProductClarificationDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-product-clarify");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-web"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "callsdk-web"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-web", "getting-started.md"),
    [
      "# Integrate Chat SDK",
      "",
      "Import the Web Chat SDK package and initialize the chat client before you connect the user.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "callsdk-web", "callplus-integration-to-chat.md"),
    [
      "# Integrate Call SDK with Chat",
      "",
      "Integrate Call into an app that already uses the Chat SDK so users can move between messaging and calling.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createGetStartedClarificationDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-get-started-clarify");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-web"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "callsdk-web"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-web", "getting-started.md"),
    [
      "# Getting started with Chat SDK",
      "",
      "Import the Web Chat SDK package, initialize the client, and connect the user.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "callsdk-web", "getting-started.md"),
    [
      "# Getting started with Call SDK",
      "",
      "Integrate the Web Call SDK and prepare the calling workflow for the current user.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createCallOneToOneDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-call-one-to-one");
  await fs.mkdir(path.join(docsRoot, "docs", "callsdk-ios"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "callsdk-ios", "one-to-one-call.md"),
    [
      "# Start a 1-to-1 call",
      "",
      "Use `startCall` to place a 1-to-1 call in the iOS Call SDK.",
      "",
      "## Receive and accept an incoming call",
      "",
      "Use `acceptCall` to accept the incoming 1-to-1 call.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createWeakChatIntegrationFollowUpDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-weak-chat-integration-followup");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-web"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-flutter"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "callsdk-web"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-android", "community-channels"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-android", "overview"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-android", "connection"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-web", "getting-started.md"),
    [
      "# Integrate Chat SDK",
      "",
      "Import the Web Chat SDK package and initialize the chat client before you connect the user.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-flutter", "getting-started.md"),
    [
      "# Integrate Chat SDK",
      "",
      "Import the Flutter Chat SDK package and initialize the chat client before you connect the user.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "callsdk-web", "callplus-integration-to-chat.md"),
    [
      "# Integrate Call SDK with Chat",
      "",
      "Integrate Call into an app that already uses the Chat SDK so users can move between messaging and calling.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-android", "overview", "integration-overview.md"),
    [
      "# Android integration overview",
      "",
      "This page explains the Android Chat SDK integration surface and the main client capabilities available after connection succeeds.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-android", "community-channels", "creating-channel.md"),
    [
      "# Creating community channels",
      "",
      "The Chat SDK does not provide client-side APIs for creating community channels or subchannels. Use the Server API to create them.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-android", "connection", "connect.md"),
    [
      "# Connect to server",
      "",
      "Your app must establish a connection to the Nexconn server before it can send and receive messages through the Chat SDK.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createServerTaskClarificationDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-server-task-clarify");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-web"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "callsdk-web"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "platform-chat-api", "webhook"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "platform-chat-api", "user"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-web", "getting-started.md"),
    [
      "# Integrate Chat SDK",
      "",
      "Import the Web Chat SDK package and initialize the chat client before you connect the user.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "callsdk-web", "callplus-integration-to-chat.md"),
    [
      "# Integrate Call SDK with Chat",
      "",
      "Integrate Call into an app that already uses the Chat SDK so users can move between messaging and calling.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "platform-chat-api", "chat-server-api-list.md"),
    [
      "# Platform Chat API list",
      "",
      "## Default behaviors",
      "",
      "Use the Server API from your app server to send messages and manage users.",
      "",
      "## User management",
      "",
      "Issue access tokens and expire access tokens.",
      "",
      "## User blocklist",
      "",
      "Add to blocklist and remove from blocklist with Server API endpoints.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "platform-chat-api", "webhook", "signature-verification.md"),
    [
      "# Verify the webhook signature",
      "",
      "To verify the webhook signature, read the signature header, compute the expected HMAC value, and reject the callback when the signature does not match.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "platform-chat-api", "user", "issue-access-token.md"),
    [
      "# Issue an access token",
      "",
      "To integrate token issuance with the Server API, call the access token endpoint from your app server and return the access token to the client after authentication succeeds.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createSelfOnlyDeleteClarificationDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-self-only-delete-clarify");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-web", "message"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-ios", "message"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-flutter", "community-channels"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-web", "message", "delete.md"),
    [
      "# Delete direct messages",
      "",
      "## Delete messages (for yourself only)",
      "",
      "Remove messages from your own view only.",
      "",
      'Create a `DirectChannel("<target-user-id>")`, load the target `Message`, and call `deleteMessagesForMe`.',
      "",
      "## Delete a message for all participants",
      "",
      "Use `deleteMessageForAll` to remove the message for everyone in the channel.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "message", "delete.md"),
    [
      "# Delete direct messages on iOS",
      "",
      "## Delete specific messages (for me only)",
      "",
      "Delete messages for the current user only on iOS.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-flutter", "community-channels", "delete-message.md"),
    [
      "# Delete community messages on Flutter",
      "",
      "## Delete messages before a timestamp (specific subchannel)",
      "",
      "Delete messages before a timestamp for the current user in Flutter.",
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

async function createIOSDirectChannelCreationDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-ios-direct-channel-creation");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-ios", "direct-system-channels"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "direct-system-channels", "overview.md"),
    [
      "# Channel overview",
      "",
      "## Create or get a channel instance",
      "",
      'Create `DirectChannel(channelId: "userId")` as the iOS direct channel instance.',
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "direct-system-channels", "deleting-channel.md"),
    [
      "# Delete a single channel",
      "",
      'Call `channel.delete()` after creating `DirectChannel(channelId: "userId")`.',
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "direct-system-channels", "pinning-channel.md"),
    [
      "# Pin a channel",
      "",
      'Call `channel.pin()` on `DirectChannel(channelId: "userId")`.',
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createIOSOpenChannelDestroyDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-ios-open-channel-destroy");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-ios", "open-channels"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-ios", "event-delegation"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "open-channels", "joining-channel.md"),
    [
      "# Join an open channel",
      "",
      'Create `OpenChannel(channelId: "channelId")`, then call `enterChannel(...)`.',
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "open-channels", "leaving-channel.md"),
    [
      "# Leave an open channel",
      "",
      "Participants can leave an open channel in two ways:",
      "",
      "- Passive removal: the server removes offline participants automatically.",
      "- Active leave: the participant explicitly exits via the SDK.",
      "",
      "## Passive removal",
      "",
      "Open channels use an auto-removal mechanism for offline participants.",
      "",
      "## Active leave",
      "",
      'Create `OpenChannel(channelId: "channelId")`, then call `exitChannel(...)` to leave it.',
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "open-channels", "platform-config.md"),
    [
      "# Open channel service configuration",
      "",
      "## Feature configuration",
      "",
      "Subscribe to webhook events when channels are created, destroyed, or when participants join or leave.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "open-channels", "managing-metadata.md"),
    [
      "# Manage open channel metadata",
      "",
      "## Delete metadata",
      "",
      "Use `OpenChannelDeleteMetadataParams` to remove one or more metadata keys from the open channel.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "event-delegation", "open-channel-delegation.md"),
    [
      "# Open channel events",
      "",
      "Use `OpenChannelHandler` to receive lifecycle and metadata events from open channels.",
      "",
      "## Enter and exit events",
      "",
      "Adopt `NCOpenChannelHandler` to observe open channel enter and exit events.",
      "",
      "When the channel is destroyed, `onChannelDestroyed(...)` fires.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createSparseWebOnboardingDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-sparse-web-onboarding");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-web", "getting-started"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-web", "direct-system-channels"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-web", "getting-started", "integration.md"),
    [
      "# Integrate Chat SDK on Web",
      "",
      "Install the Chat SDK package, initialize the client, and connect the current user before you start a conversation.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-web", "direct-system-channels", "send-first-message.md"),
    [
      "# Send the first direct message",
      "",
      "Create a direct channel for the target user and call `sendTextMessage(...)` after the client finishes connecting.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createAndroidMessageHistoryDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-android-message-history");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-android", "message"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-ios", "message"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-android", "channels"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-android", "message", "send.md"),
    [
      "# Send a message on Android",
      "",
      "Create `SendTextMessageParams`, then call `channel.sendMessage(...)` in the Android Chat SDK.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-android", "message", "recall.md"),
    [
      "# Recall a message on Android",
      "",
      "Load the target Android message and call `deleteMessageForAll(...)` to recall it for everyone.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "message", "recall.md"),
    [
      "# Recall a message on iOS",
      "",
      "Use the iOS SDK delete-for-all API to recall a message.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-android", "message", "delete-for-me.md"),
    [
      "# Delete a message for yourself on Android",
      "",
      "Use `deleteMessagesForMe(...)` to remove the message for the current user only on Android.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-android", "channels", "create.md"),
    [
      "# Create a channel on Android",
      "",
      "Use the Android channel creation flow to create a group channel.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createSystemNotificationAmbiguityDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-system-notification-ambiguity");
  await fs.mkdir(path.join(docsRoot, "docs", "guides", "realtime-chat", "intro-chat"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "platform-chat-api", "system"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "guides", "realtime-chat", "intro-chat", "intro-chat.mdx"),
    [
      "# Intro to realtime chat",
      "",
      "## Server APIs",
      "",
      "Some advanced features are only available through Chat Server APIs, including system notifications, broadcast to online users, and user bans.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "platform-chat-api", "system", "send-private.md"),
    [
      "# Send a system message",
      "",
      "Use `/v4/system-channel/message/send` to send a system message from your app server.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "platform-chat-api", "system", "send-push-by-tag.md"),
    [
      "# Push to tagged users",
      "",
      "Use `/v4/system-channel/push` to deliver a push notification to tagged users from your app server.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

void test("executeDocQuestion asks for product clarification before answering generic connect questions", async () => {
  const docsRoot = await createConnectClarificationDocs();
  const result = await executeDocQuestion({
    runId: "connect-clarify-1",
    question: "How to connect?",
    mode: "extractive",
    docsRoot,
    maxResults: 4,
  });

  assert.equal(result.route, "search");
  assert.equal(result.answer.summary, "product clarification required");
  assert.equal(result.answer.answer.includes("Chat SDK"), true);
  assert.equal(result.answer.answer.includes("Server API"), true);
});

void test("executeDocQuestion asks for product clarification before answering generic get-started questions", async () => {
  const docsRoot = await createGetStartedClarificationDocs();
  const result = await executeDocQuestion({
    runId: "get-started-clarify-1",
    question: "How can I get started?",
    mode: "agent",
    docsRoot,
    maxResults: 4,
  });

  assert.equal(result.route, "search");
  assert.equal(result.answer.summary, "product clarification required");
  assert.equal(result.answer.answer.includes("Chat SDK"), true);
  assert.equal(result.answer.answer.includes("Call SDK"), true);
});

void test("executeDocQuestion asks for referent clarification before blocking on ambiguous system notification wording", async () => {
  const docsRoot = await createSystemNotificationAmbiguityDocs();
  const result = await executeDocQuestion({
    runId: "system-notification-clarify-1",
    question: "can I send system notification using server api?",
    mode: "extractive",
    docsRoot,
    maxResults: 5,
  });

  assert.equal(result.route, "search");
  assert.equal(result.answer.summary, "task clarification required");
  assert.equal(result.answer.pendingClarificationKind, "referent");
  assert.equal(result.answer.answer.includes("system message"), true);
  assert.equal(result.answer.answer.includes("push notification"), true);
});

void test("product clarification follow-up rewrites the generic connect question and continues", async () => {
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
  assert.equal(second.answer.rewrittenQuestion, "How to connect for Server API?");
  assert.notEqual(second.answer.summary, "product clarification required");
});

void test("Call SDK one-to-one questions answer from call docs without direct-channel clarification leakage", async () => {
  const docsRoot = await createCallOneToOneDocs();
  const result = await executeDocQuestion({
    runId: "call-one-to-one-1",
    question: "How do I start or accept a 1-to-1 call in the iOS Call SDK?",
    mode: "extractive",
    docsRoot,
    maxResults: 5,
  });

  assert.notEqual(result.answer.summary, "insufficient documentation evidence");
  assert.equal(result.answer.answer.includes("direct channel"), false);
  assert.equal(result.hits[0]?.path.endsWith("docs/callsdk-ios/one-to-one-call.md"), true);
});

void test("product clarification follow-up rewrites the question and continues", async () => {
  const docsRoot = await createProductClarificationDocs();
  const dataDir = await makeTempDir("doc-assistant-product-followup");
  const sessionId = "product-followup-session";

  const first = await executeDocQuestion({
    runId: "product-clarify-1",
    question: "How to integrate?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(first.answer.summary, "product clarification required");
  assert.equal(first.answer.pendingClarificationKind, "product");

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "product-clarify-1",
    question: "How to integrate?",
    hits: first.hits,
    summary: first.answer.summary,
    pendingQuestion: first.answer.pendingClarificationQuestion,
    clarificationKind: first.answer.pendingClarificationKind,
    clarificationHits: first.answer.clarificationHits,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "product-clarify-2",
    question: "Chat",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(second.answer.followUpSource, "clarification_rewrite");
  assert.equal(second.answer.rewrittenQuestion, "How to integrate for Chat SDK?");
  assert.equal(second.answer.answer.includes("Call SDK"), false);
  assert.equal(second.answer.answer.includes("Integrate Call"), false);
});

void test("server integration follow-up asks for narrower task focus before answering from catalog pages", async () => {
  const docsRoot = await createServerTaskClarificationDocs();
  const dataDir = await makeTempDir("doc-assistant-server-task-followup");
  const sessionId = "server-task-followup-session";

  const first = await executeDocQuestion({
    runId: "server-task-clarify-1",
    question: "How to integrate?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(first.answer.summary, "product clarification required");

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "server-task-clarify-1",
    question: "How to integrate?",
    hits: first.hits,
    summary: first.answer.summary,
    pendingQuestion: first.answer.pendingClarificationQuestion,
    clarificationKind: first.answer.pendingClarificationKind,
    clarificationHits: first.answer.clarificationHits,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "server-task-clarify-2",
    question: "Server API",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(second.answer.followUpSource, "clarification_rewrite");
  assert.equal(second.answer.rewrittenQuestion, "How to integrate for Server API?");
  assert.equal(second.answer.summary, "task clarification required");
  assert.equal(second.answer.answer.includes("User blocklist"), false);
  assert.equal(second.answer.answer.includes("access token"), true);
  assert.equal(second.answer.answer.includes("webhook signature verification"), true);

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "server-task-clarify-2",
    question: "Server API",
    hits: second.hits,
    summary: second.answer.summary,
    pendingQuestion: second.answer.pendingClarificationQuestion,
    clarificationKind: second.answer.pendingClarificationKind,
    clarificationHits: second.answer.clarificationHits,
    route: second.route,
    dataDir,
  });

  const third = await executeDocQuestion({
    runId: "server-task-clarify-3",
    question: "webhook signature verification",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(third.answer.followUpSource, "clarification_rewrite");
  assert.equal(
    third.answer.rewrittenQuestion,
    "How to integrate for Server API for webhook signature verification?",
  );
  assert.notEqual(third.answer.summary, "task clarification required");
  assert.equal(third.answer.answer.toLowerCase().includes("signature"), true);
  assert.equal(third.answer.answer.includes("User blocklist"), false);
});

void test("server integration task-focus follow-up accepts token/auth and retrieves token docs", async () => {
  const docsRoot = await createServerTaskClarificationDocs();
  const dataDir = await makeTempDir("doc-assistant-server-token-followup");
  const sessionId = "server-token-followup-session";

  const first = await executeDocQuestion({
    runId: "server-token-clarify-1",
    question: "How to integrate?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "server-token-clarify-1",
    question: "How to integrate?",
    hits: first.hits,
    summary: first.answer.summary,
    pendingQuestion: first.answer.pendingClarificationQuestion,
    clarificationKind: first.answer.pendingClarificationKind,
    clarificationHits: first.answer.clarificationHits,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "server-token-clarify-2",
    question: "Server API",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "server-token-clarify-2",
    question: "Server API",
    hits: second.hits,
    summary: second.answer.summary,
    pendingQuestion: second.answer.pendingClarificationQuestion,
    clarificationKind: second.answer.pendingClarificationKind,
    clarificationHits: second.answer.clarificationHits,
    route: second.route,
    dataDir,
  });

  const third = await executeDocQuestion({
    runId: "server-token-clarify-3",
    question: "token/auth",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(third.answer.followUpSource, "clarification_rewrite");
  assert.equal(third.answer.rewrittenQuestion, "How to integrate for Server API for token/auth?");
  assert.notEqual(third.answer.summary, "task clarification required");
  assert.notEqual(third.answer.summary, "insufficient documentation evidence");
  assert.equal(
    third.hits.some((hit) => hit.path.includes("platform-chat-api/user/issue-access-token.md")),
    true,
  );
});

void test("server integration task-focus follow-up accepts blocklist management as open-set focus", async () => {
  const docsRoot = await createServerTaskClarificationDocs();
  const dataDir = await makeTempDir("doc-assistant-server-blocklist-followup");
  const sessionId = "server-blocklist-followup-session";

  const first = await executeDocQuestion({
    runId: "server-blocklist-clarify-1",
    question: "How to integrate?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "server-blocklist-clarify-1",
    question: "How to integrate?",
    hits: first.hits,
    summary: first.answer.summary,
    pendingQuestion: first.answer.pendingClarificationQuestion,
    clarificationKind: first.answer.pendingClarificationKind,
    clarificationHits: first.answer.clarificationHits,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "server-blocklist-clarify-2",
    question: "Server API",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "server-blocklist-clarify-2",
    question: "Server API",
    hits: second.hits,
    summary: second.answer.summary,
    pendingQuestion: second.answer.pendingClarificationQuestion,
    clarificationKind: second.answer.pendingClarificationKind,
    clarificationHits: second.answer.clarificationHits,
    route: second.route,
    dataDir,
  });

  const third = await executeDocQuestion({
    runId: "server-blocklist-clarify-3",
    question: "blocklist management",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(third.answer.followUpSource, "clarification_rewrite");
  assert.equal(
    third.answer.rewrittenQuestion,
    "How to integrate for Server API for blocklist management?",
  );
  assert.notEqual(third.answer.summary, "task clarification required");
  assert.notEqual(third.answer.summary, "insufficient documentation evidence");
  assert.equal(
    third.hits.some((hit) => hit.path.includes("platform-chat-api/chat-server-api-list.md")),
    true,
  );
});

void test("referent clarification follow-up rewrites ambiguous system notification wording and continues", async () => {
  const docsRoot = await createSystemNotificationAmbiguityDocs();
  const dataDir = await makeTempDir("doc-assistant-system-notification-followup");
  const sessionId = "system-notification-followup-session";

  const first = await executeDocQuestion({
    runId: "system-notification-clarify-2",
    question: "can I send system notification using server api?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(first.answer.pendingClarificationKind, "referent");

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "system-notification-clarify-2",
    question: "can I send system notification using server api?",
    hits: first.hits,
    summary: first.answer.summary,
    pendingQuestion: first.answer.pendingClarificationQuestion,
    clarificationKind: first.answer.pendingClarificationKind,
    clarificationHits: first.answer.clarificationHits,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "system-notification-clarify-3",
    question: "system message",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(second.answer.followUpSource, "clarification_rewrite");
  assert.equal(second.answer.rewrittenQuestion, "can I send system message using server api?");
  assert.notEqual(second.answer.summary, "insufficient documentation evidence");
  assert.equal(
    second.hits.some((hit) => hit.path.endsWith("docs/platform-chat-api/system/send-private.md")),
    true,
  );
});

void test("broad Chat SDK integration follow-up reruns retrieval and refuses weak Android-only reuse", async () => {
  const docsRoot = await createWeakChatIntegrationFollowUpDocs();
  const dataDir = await makeTempDir("doc-assistant-weak-chat-integration-followup-data");
  const sessionId = "weak-chat-integration-followup-session";
  const clarificationHits = await searchDocs({
    query: "How to integrate for Chat SDK?",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "weak-chat-integration-1",
    question: "How to integrate for Chat SDK?",
    hits: clarificationHits,
    summary: "platform clarification required",
    pendingQuestion: "How to integrate for Chat SDK?",
    clarificationKind: "platform",
    clarificationHits,
    route: "search",
    dataDir,
  });

  const third = await executeDocQuestion({
    runId: "weak-chat-integration-2",
    question: "Android",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(third.answer.followUpSource, "clarification_rewrite");
  assert.equal(third.answer.rewrittenQuestion, "How to integrate for Chat SDK on Android?");
  assert.equal(third.answer.summary, "insufficient documentation evidence");
  assert.equal(third.answer.answer.includes("start a direct chat"), false);
});

void test("platform clarification reuse accepts self-only delete wording after semantic normalization", async () => {
  const docsRoot = await createSelfOnlyDeleteClarificationDocs();
  const dataDir = await makeTempDir("doc-assistant-self-only-delete-followup");
  const sessionId = "self-only-delete-followup-session";

  const first = await executeDocQuestion({
    runId: "self-only-delete-clarify-1",
    question: "how to delete message for myself?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(first.answer.summary, "platform clarification required");

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "self-only-delete-clarify-1",
    question: "how to delete message for myself?",
    hits: first.hits,
    summary: first.answer.summary,
    pendingQuestion: first.answer.pendingClarificationQuestion,
    clarificationKind: first.answer.pendingClarificationKind,
    clarificationHits: first.answer.clarificationHits,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "self-only-delete-clarify-2",
    question: "web",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(second.answer.followUpSource, "clarification_reuse");
  assert.equal(second.answer.rewrittenQuestion, "how to delete message for myself on Web?");
  assert.notEqual(second.answer.summary, "insufficient documentation evidence");
  assert.equal(second.answer.summary.startsWith("guided answer from "), true);
  assert.equal(
    second.hits.some((hit) => hit.path.includes("docs/chatsdk-web/message/delete.md")),
    true,
  );
});

void test("platform clarification examples prefer docs that match the asked action", () => {
  const result = renderClarificationAnswer({
    decision: { shouldClarify: true, kind: "platform" },
    question: "How to pin a channel?",
    mode: "extractive",
    hits: [
      {
        path: "docs/chatsdk-ios/direct-system-channels/pinning-channel.md",
        heading: "Pin a channel in the channel list",
        startLine: 16,
        endLine: 19,
        snippet:
          "Pinning a channel updates the `isPinned` field on `NCBaseChannel` and syncs the state to the server.",
        text: "Pinning a channel updates the `isPinned` field on `NCBaseChannel` and syncs the state to the server.",
        score: 48,
        docShape: "generic_reference",
      },
      {
        path: "docs/chatsdk-android/community-channels/creating-channel.md",
        heading: "Creating community channels",
        startLine: 6,
        endLine: 9,
        snippet:
          "The Chat SDK does not provide client-side APIs for creating community channels or subchannels.",
        text: "The Chat SDK does not provide client-side APIs for creating community channels or subchannels.",
        score: 46,
        docShape: "specialized_task",
      },
      {
        path: "docs/chatsdk-ios/group-channels/manage-group-channel.md",
        heading: "Create a group",
        startLine: 84,
        endLine: 150,
        snippet: "Call `GroupChannel.createGroup(params:completion:)` to create a new group.",
        text: "Call `GroupChannel.createGroup(params:completion:)` to create a new group.",
        score: 46,
        docShape: "specialized_task",
      },
    ],
  });

  assert.equal(result.summary, "platform clarification required");
  assert.equal(result.answer.includes("Pin a channel in the channel list"), true);
  assert.equal(result.answer.includes("Creating community channels"), false);
});

void test("resolved-answer follow-up rewrites dependent code-snippet requests onto the prior topic", async () => {
  const docsRoot = await createIOSDirectChannelCreationDocs();
  const dataDir = await makeTempDir("doc-assistant-pin-code-followup");
  const sessionId = "pin-code-followup-session";

  const first = await executeDocQuestion({
    runId: "pin-code-followup-1",
    question: "How to pin a channel on iOS?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(first.answer.summary.startsWith("guided answer from "), true);

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "pin-code-followup-1",
    question: "How to pin a channel on iOS?",
    hits: first.hits,
    summary: first.answer.summary,
    rewrittenQuestion: first.answer.rewrittenQuestion,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "pin-code-followup-2",
    question: "Can you give me a code snippet about it?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(second.answer.followUpSource, "contextual_rewrite");
  assert.equal(second.answer.continuedFromRunId, "pin-code-followup-1");
  assert.equal(second.answer.rewrittenQuestion, "How to pin a channel on iOS Show a code snippet.");
  assert.notEqual(second.answer.summary, "insufficient documentation evidence");
  assert.equal(
    second.hits.some((hit) =>
      hit.path.includes("docs/chatsdk-ios/direct-system-channels/pinning-channel.md"),
    ),
    true,
  );
});

void test("llm follow-up fallback can rewrite sequential example requests when heuristics do not match", async (t) => {
  const docsRoot = await createIOSDirectChannelCreationDocs();
  const dataDir = await makeTempDir("doc-assistant-llm-followup");
  const sessionId = "llm-followup-session";
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const first = await executeDocQuestion({
    runId: "llm-followup-1",
    question: "How to pin a channel on iOS?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "llm-followup-1",
    question: "How to pin a channel on iOS?",
    hits: first.hits,
    summary: first.answer.summary,
    rewrittenQuestion: first.answer.rewrittenQuestion,
    route: first.route,
    dataDir,
  });

  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_rewrite: true,
                rewritten_question: "How to pin a channel on iOS? Show an example.",
                reason: "The latest turn depends on the previous question.",
              }),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;

  const second = await executeDocQuestion({
    runId: "llm-followup-2",
    question: "Could you also show the example for that one?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
    openAICompatible: {
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
    },
  });

  assert.equal(second.answer.followUpSource, "contextual_rewrite");
  assert.equal(second.answer.continuedFromRunId, "llm-followup-1");
  assert.equal(second.answer.rewrittenQuestion, "How to pin a channel on iOS? Show an example.");
  assert.notEqual(second.answer.summary, "insufficient documentation evidence");
  assert.equal(
    second.hits.some((hit) =>
      hit.path.includes("docs/chatsdk-ios/direct-system-channels/pinning-channel.md"),
    ),
    true,
  );
});

void test("executeDocQuestion treats partial-only push language matches as insufficient evidence", async () => {
  const docsRoot = await createPushLanguagePartialOnlyDocs();
  const dataDir = await makeTempDir("doc-assistant-push-language-partial-data");
  const result = await executeDocQuestion({
    runId: "push-language-partial-1",
    question: "How to change the default language for push notification?",
    mode: "extractive",
    docsRoot,
    dataDir,
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

void test("unseen platform follow-up reruns retrieval instead of replaying the prior clarification", async () => {
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

  assert.equal(invalid.answer.summary, "insufficient documentation evidence");
  assert.equal(invalid.answer.followUpSource, "clarification_rewrite");
  assert.equal(invalid.answer.rewrittenQuestion, "How to create a direct channel on Web?");
  assert.equal(invalid.answer.answer.includes("Android / Flutter"), false);

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
  assert.equal(result.answer.answer.includes("send the first message"), false);
  assert.equal(result.answer.answer.includes("DirectChannel"), true);
});

void test("direct-channel creation on iOS prefers channel creation docs over delete or pin docs", async () => {
  const docsRoot = await createIOSDirectChannelCreationDocs();
  const result = await executeDocQuestion({
    runId: "ios-direct-channel-creation-1",
    question: "How to create a direct channel on iOS?",
    mode: "extractive",
    docsRoot,
    maxResults: 5,
  });

  assert.equal(result.answer.summary.includes("insufficient"), false);
  assert.equal(result.answer.answer.includes("Create `DirectChannel"), true);
  assert.equal(result.answer.answer.includes("delete"), false);
  assert.equal(result.answer.answer.includes("pin"), false);
});

void test("destroy-open-channel questions do not drift into join steps when only leave docs match", async () => {
  const docsRoot = await createIOSOpenChannelDestroyDocs();
  const result = await executeDocQuestion({
    runId: "ios-open-channel-destroy-1",
    question: "How to destroy an open channel on iOS?",
    mode: "extractive",
    docsRoot,
    maxResults: 5,
  });

  assert.equal(result.answer.summary.includes("insufficient"), false);
  assert.equal(result.answer.answer.toLowerCase().includes("join an open channel"), false);
  assert.equal(result.answer.answer.includes("exitChannel"), true);
  assert.equal(result.answer.answer.includes("destroys the channel itself"), true);
  assert.equal(result.answer.answer.includes("OpenChannelDeleteMetadataParams"), false);
  assert.equal(result.answer.answer.includes("NCOpenChannelHandler"), false);
});

void test("executeDocQuestion expands retrieval dynamically when the first pass is sparse", async () => {
  const docsRoot = await createSparseWebOnboardingDocs();
  const result = await executeDocQuestion({
    runId: "dynamic-retrieval-budget-1",
    question: "How do I integrate Chat SDK on Web and send the first direct message?",
    mode: "extractive",
    docsRoot,
  });

  const trace = (result.answer.trace ?? {}) as {
    retrievalBudget?: {
      hitLimit: number;
      retryUsed?: boolean;
      retryReasons?: string[];
      finalHitLimit?: number;
    };
  };

  assert.equal(result.route, "search");
  assert.equal(trace.retrievalBudget?.hitLimit, 4);
  assert.equal(trace.retrievalBudget?.retryUsed, true);
  assert.equal(trace.retrievalBudget?.retryReasons?.includes("low_hit_count"), true);
  assert.equal((trace.retrievalBudget?.finalHitLimit ?? 0) > trace.retrievalBudget.hitLimit, true);
});

void test("conversation history rewrites Android send-message follow-ups onto recall", async () => {
  const docsRoot = await createAndroidMessageHistoryDocs();
  const dataDir = await makeTempDir("doc-assistant-conversation-recall");
  const sessionId = "conversation-recall-session";

  const first = await executeDocQuestion({
    runId: "conversation-recall-1",
    question: "How to send a message on Android?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  await updateConversationStateAfterAnswer({
    sessionId,
    runId: "conversation-recall-1",
    question: "How to send a message on Android?",
    answer: first.answer,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "conversation-recall-2",
    question: "How to recall?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(second.answer.followUpSource, "conversation_rewrite");
  assert.equal(second.answer.rewrittenQuestion, "How to recall a message on Android?");
  assert.equal(second.answer.answer.toLowerCase().includes("recall"), true);
  assert.equal(second.hits[0]?.path.includes("docs/chatsdk-android/message/recall.md"), true);
});

void test("conversation history preserves message-management focus for delete-for-self follow-ups", async () => {
  const docsRoot = await createAndroidMessageHistoryDocs();
  const dataDir = await makeTempDir("doc-assistant-conversation-delete");
  const sessionId = "conversation-delete-session";

  const first = await executeDocQuestion({
    runId: "conversation-delete-1",
    question: "How to send a message on Android?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  await updateConversationStateAfterAnswer({
    sessionId,
    runId: "conversation-delete-1",
    question: "How to send a message on Android?",
    answer: first.answer,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "conversation-delete-2",
    question: "How to delete for myself?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(second.answer.followUpSource, "conversation_rewrite");
  assert.equal(second.answer.rewrittenQuestion, "How to delete a message for myself on Android?");
  assert.equal(
    second.hits.some((hit) => hit.path.includes("docs/chatsdk-android/message/delete-for-me.md")),
    true,
  );
});

void test("conversation history does not override explicit platform changes", async () => {
  const docsRoot = await createAndroidMessageHistoryDocs();
  const dataDir = await makeTempDir("doc-assistant-conversation-platform-conflict");
  const sessionId = "conversation-platform-conflict-session";

  const first = await executeDocQuestion({
    runId: "conversation-platform-conflict-1",
    question: "How to send a message on Android?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  await updateConversationStateAfterAnswer({
    sessionId,
    runId: "conversation-platform-conflict-1",
    question: "How to send a message on Android?",
    answer: first.answer,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "conversation-platform-conflict-2",
    question: "How to connect on iOS?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  const trace = (second.answer.trace ?? {}) as {
    history?: {
      blockedReason?: string;
    };
  };

  assert.equal(second.answer.followUpSource, undefined);
  assert.equal(second.answer.rewrittenQuestion, undefined);
  assert.equal(trace.history?.blockedReason, "explicit_platform_conflict");
});

void test("conversation history does not leak message-management anchors into new channel tasks", async () => {
  const docsRoot = await createAndroidMessageHistoryDocs();
  const dataDir = await makeTempDir("doc-assistant-conversation-topic-shift");
  const sessionId = "conversation-topic-shift-session";

  const first = await executeDocQuestion({
    runId: "conversation-topic-shift-1",
    question: "How to send a message on Android?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  await updateConversationStateAfterAnswer({
    sessionId,
    runId: "conversation-topic-shift-1",
    question: "How to send a message on Android?",
    answer: first.answer,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "conversation-topic-shift-2",
    question: "How to create a channel?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(second.answer.followUpSource, "conversation_rewrite");
  assert.equal(String(second.answer.rewrittenQuestion).includes("message"), false);
  assert.equal(second.answer.answer.toLowerCase().includes("create a group channel"), true);
  assert.equal(second.answer.answer.includes("deleteMessagesForMe"), false);
});

void test("raw greetings bypass conversation history rewrites and return the greeting route", async () => {
  const docsRoot = await createAndroidMessageHistoryDocs();
  const dataDir = await makeTempDir("doc-assistant-conversation-greeting-route");
  const sessionId = "conversation-greeting-route-session";

  await updateConversationStateAfterAnswer({
    sessionId,
    runId: "conversation-greeting-route-1",
    question: "How to send a message on Android?",
    answer: {
      mode: "extractive",
      answer: "Use sendMessage on Android.",
      summary: "grounded answer",
      citations: [],
      rewrittenQuestion: "How to send a message on Android?",
      trace: {
        taskFrame: {
          anchors: {
            focus: ["message"],
            verbs: ["send"],
            constraints: [],
            apiSymbols: [],
          },
        },
      },
    },
    route: "search",
    dataDir,
  });

  const result = await executeDocQuestion({
    runId: "conversation-greeting-route-2",
    question: "hello",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(result.route, "greeting");
  assert.equal(result.answer.summary, "guided greeting");
  assert.equal(result.answer.followUpSource, undefined);
  assert.equal(result.answer.rewrittenQuestion, undefined);
});

void test("answer memory lookup uses the conversation-resolved question", async () => {
  const docsRoot = await createAndroidMessageHistoryDocs();
  const dataDir = await makeTempDir("doc-assistant-conversation-answer-memory");
  const sessionId = "conversation-answer-memory-session";

  await replaceAnswerMemoryEntries(
    [
      {
        entryId: "conversation-answer-memory-entry",
        question: "How to recall a message on Android?",
        normalizedQuestion: "how to recall a message on android",
        questionVariants: ["How to recall a message on Android?"],
        normalizedQuestionVariants: ["how to recall a message on android"],
        answer: "Use the approved Android recall answer.",
        summary: "memory summary",
        citations: [],
        mode: "extractive",
        reviewStatus: "approved_standard",
        createdAt: 1,
        updatedAt: 1,
        lastSeenAt: 1,
        hitCount: 1,
        provenance: "admin_approved",
      },
    ],
    dataDir,
  );

  const first = await executeDocQuestion({
    runId: "conversation-answer-memory-1",
    question: "How to send a message on Android?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  await updateConversationStateAfterAnswer({
    sessionId,
    runId: "conversation-answer-memory-1",
    question: "How to send a message on Android?",
    answer: first.answer,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "conversation-answer-memory-2",
    question: "How to recall?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(second.route, "memory");
  assert.equal(second.answer.followUpSource, "conversation_rewrite");
  assert.equal(second.answer.rewrittenQuestion, "How to recall a message on Android?");
  assert.equal(second.answer.answer, "Use the approved Android recall answer.");
});

void test("retrieval memory lookup uses the conversation-resolved question", async () => {
  const docsRoot = await createAndroidMessageHistoryDocs();
  const dataDir = await makeTempDir("doc-assistant-conversation-retrieval-memory");
  const sessionId = "conversation-retrieval-memory-session";

  await saveRetrievalMemoryEntries(
    [
      {
        entryId: "conversation-retrieval-memory-entry",
        questionPattern: "How to recall a message on Android?",
        normalizedQuestionPattern: "how to recall a message on android",
        preferredPaths: ["docs/chatsdk-android/message/recall.md"],
        discouragedPaths: ["docs/chatsdk-android/message/send.md"],
        createdAt: 1,
        updatedAt: 1,
        source: "manual",
      },
    ],
    dataDir,
  );

  const first = await executeDocQuestion({
    runId: "conversation-retrieval-memory-1",
    question: "How to send a message on Android?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  await updateConversationStateAfterAnswer({
    sessionId,
    runId: "conversation-retrieval-memory-1",
    question: "How to send a message on Android?",
    answer: first.answer,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "conversation-retrieval-memory-2",
    question: "How to recall?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  const trace = (second.answer.trace ?? {}) as {
    memory?: {
      kind?: string;
    };
    history?: {
      blockedReason?: string;
    };
  };

  assert.equal(second.answer.followUpSource, "conversation_rewrite");
  assert.equal(second.answer.rewrittenQuestion, "How to recall a message on Android?");
  assert.equal(trace.memory?.kind, "retrieval_memory");
  assert.equal(trace.history?.blockedReason, undefined);
});
