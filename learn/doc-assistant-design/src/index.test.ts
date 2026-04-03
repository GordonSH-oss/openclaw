import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { replaceAnswerMemoryEntries } from "./answer-memory.js";
import { buildDocAnswer } from "./doc-answer.js";
import { resolveDefaultDocsRoot } from "./doc-index.js";
import { planDocQuestion, searchDocs } from "./doc-search.js";
import {
  detectClarificationFollowUpQuestion,
  rewriteClarificationQuestion,
  shouldReuseClarificationHits,
  updateClarificationStateAfterAnswer,
} from "./follow-up-context.js";
import { detectGreetingIntent } from "./greeting-intent.js";
import type {
  AnswerMemoryEntry,
  DocAssistantEvent,
  DocAssistantResponse,
  DocsAcceptedResult,
  DocsTerminalResult,
} from "./protocol/index.js";
import { executeDocQuestion } from "./question-execution.js";
import { createDocAssistantRouter } from "./server-methods.js";
import { createDocAssistantRuntimeState } from "./server-runtime-state.js";
import { handleConnection } from "./ws-connection.js";

async function makeTempDir(name: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function createGreetingFixtureDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-greeting-docs");
  await fs.mkdir(path.join(docsRoot, "chatsdk-android"), { recursive: true });
  await fs.mkdir(path.join(docsRoot, "callsdk-ios"), { recursive: true });
  await fs.writeFile(
    path.join(docsRoot, "chatsdk-android", "getting-started.md"),
    "# Getting started\n\nInitialize the Android Chat SDK and send your first message.\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "callsdk-ios", "one-to-one-call.md"),
    "# One-to-one call\n\nStart or accept a one-to-one call on iOS.\n",
    "utf-8",
  );
  return docsRoot;
}

async function createClarificationReuseFixtureDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-followup-reuse-docs");
  for (const platform of ["android", "ios", "web"]) {
    await fs.mkdir(path.join(docsRoot, `chatsdk-${platform}`), { recursive: true });
  }
  await fs.writeFile(
    path.join(docsRoot, "chatsdk-android", "quickstart.md"),
    [
      "# Chat quickstart",
      "",
      "Use the Android Chat SDK quickstart to start chat features.",
      "",
      "## Direct channel",
      "",
      "A direct channel starts a one-to-one chat on Android with `DirectChannel`.",
      "",
      "## Send a message",
      "",
      "Create `SendTextMessageParams` and call `channel.sendMessage(...)` on Android.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "chatsdk-ios", "quickstart.md"),
    [
      "# Chat quickstart",
      "",
      "Use the iOS Chat SDK quickstart to start chat features.",
      "",
      "## Send a message",
      "",
      "Create a direct channel and send the first iOS message.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "chatsdk-web", "quickstart.md"),
    [
      "# Chat quickstart",
      "",
      "Use the Web Chat SDK quickstart to start chat features.",
      "",
      "## Send a message",
      "",
      "Create a direct channel and send the first Web message.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createClarificationRewriteFixtureDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-followup-rewrite-docs");
  for (const platform of ["android", "ios", "web"]) {
    await fs.mkdir(path.join(docsRoot, `chatsdk-${platform}`), { recursive: true });
  }
  await fs.writeFile(
    path.join(docsRoot, "chatsdk-android", "send.md"),
    [
      "# Send a message",
      "",
      "Android chat starts from a direct channel and then sends the first message.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "chatsdk-ios", "send.md"),
    [
      "# Send a message",
      "",
      "iOS chat starts from a direct channel and then sends the first message.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "chatsdk-web", "send.md"),
    [
      "# Send a message",
      "",
      "Web chat starts from a direct channel and then sends the first message.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createLifecycleFixtureDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-lifecycle-docs");
  await fs.mkdir(path.join(docsRoot, "docs", "install"), { recursive: true });
  await fs.mkdir(path.join(docsRoot, "docs", "skills"), { recursive: true });
  await fs.writeFile(
    path.join(docsRoot, "docs", "install", "node.md"),
    [
      "# Node requirements",
      "",
      "OpenClaw requires Node 22 or later.",
      "",
      "## Check your version",
      "",
      "Run `node --version` to check your current Node version.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "skills", "overview.md"),
    [
      "# Skills overview",
      "",
      "OpenClaw loads workspace skills from `.agents/skills` and personal skills from `$CODEX_HOME/skills`.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createPushFixtureDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-push-docs");
  await fs.mkdir(path.join(docsRoot, "callsdk-ios"), { recursive: true });
  await fs.writeFile(
    path.join(docsRoot, "callsdk-ios", "push-config.md"),
    [
      "# Push config",
      "",
      "Use `NCCallPushConfig` to configure pushTitle and pushContent before starting a call.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createPushLanguageDriftFixtureDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-push-language-drift-docs");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-android", "push"), { recursive: true });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-android", "push", "handle-push-notification-click.md"),
    [
      "# Handle push notification click",
      "",
      "## Use PushMessageReceiver",
      "",
      "You can customize click behavior through `PushMessageReceiver.onNotificationMessageClicked()`.",
      "",
      "Add an `intent-filter` so notification taps can open the target conversation page.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-android", "push", "config-push-notification-style.md"),
    [
      "# Customize push notification style",
      "",
      "When the app receives a push notification, the system displays a notification.",
      "",
      "Use `PushMessageReceiver.onNotificationMessageArrived()` to intercept the incoming FCM data message and apply custom notification display logic.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createPushLanguageCoverageFixtureDocs(): Promise<string> {
  const docsRoot = await createPushLanguageDriftFixtureDocs();
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-android", "push", "set-push-notification-language.md"),
    [
      "# Set push notification language",
      "",
      "Configure the push notification language and localization behavior for Android push notifications.",
      "",
      "Set the default language or locale that the push payload should use before the notification is displayed.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createClientConnectFixtureDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-connect-docs");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-android", "connection"), { recursive: true });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-ios", "connection"), { recursive: true });
  await fs.mkdir(path.join(docsRoot, "docs", "platform-chat-api"), { recursive: true });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-android", "connection", "connect.md"),
    [
      "# Connect",
      "",
      "Get an access token for the current user and call `NCEngine.connect(...)` to connect to the chat server on Android.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "connection", "connect.md"),
    [
      "# Connect",
      "",
      "Get an access token for the current user and connect to the chat server on iOS.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "platform-chat-api", "chat-server-api-list.md"),
    [
      "# Default behaviors",
      "",
      "This page lists server API behaviors.",
      "",
      "## Channel management",
      "",
      "Use the Platform Chat API for server-side channel management.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createSendMessageFixtureDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-send-docs");
  const docsDir = path.join(docsRoot, "docs");
  await fs.mkdir(path.join(docsDir, "chatsdk-android", "message"), { recursive: true });
  await fs.mkdir(path.join(docsDir, "chatsdk-ios", "message"), { recursive: true });
  await fs.mkdir(path.join(docsDir, "chatsdk-web"), { recursive: true });
  await fs.mkdir(path.join(docsDir, "platform-chat-api", "message"), { recursive: true });

  await fs.writeFile(
    path.join(docsDir, "chatsdk-android", "message", "send.md"),
    [
      "# Send messages",
      "",
      "## Send a text message",
      "",
      "Build `SendTextMessageParams` and call `channel.sendMessage(...)` to send a text message on Android.",
      "",
      "## Send an image message",
      "",
      "Build `SendImageMessageParams` and call `channel.sendMessage(...)` to send an image message on Android.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsDir, "chatsdk-android", "getting-started.md"),
    [
      "# Getting started",
      "",
      "## Step 5: Send a message",
      "",
      "Build `SendTextMessageParams` and call `channel.sendMessage(...)` to send your first Android message.",
      "",
      "For more message types and detailed API usage, see `/chatsdk-android/message/send`.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsDir, "chatsdk-ios", "message", "send.md"),
    [
      "# Send messages",
      "",
      "## Send a regular message",
      "",
      "Build `SendTextMessageParams` and call `channel.sendMessage(...)` to send a regular message on iOS.",
      "",
      "## Send a media message",
      "",
      "Build `SendImageMessageParams` and call `channel.sendMessage(...)` to send a media message on iOS.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsDir, "chatsdk-ios", "quickstart.md"),
    [
      "# Quickstart",
      "",
      "## Step 5: Send a message",
      "",
      "Build `SendTextMessageParams` and call `channel.sendMessage(...)` to send your first iOS message.",
      "",
      "For the dedicated message APIs, see `/chatsdk-ios/message/send`.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsDir, "chatsdk-web", "quickstart.md"),
    [
      "# Quickstart",
      "",
      "## Send a message",
      "",
      "Use the Web quickstart to send your first message after setup.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsDir, "platform-chat-api", "message", "how-to-sync-to-sender-client.md"),
    [
      "# Set the isEchoToSender parameter",
      "",
      "Use the server-side setting to sync the message back to the sender.",
      "",
    ].join("\n"),
    "utf-8",
  );

  return docsRoot;
}

async function createCommunityChannelFixtureDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-community-docs");
  const docsDir = path.join(docsRoot, "docs");
  await fs.mkdir(path.join(docsDir, "chatsdk-android", "community-channels"), { recursive: true });
  await fs.mkdir(path.join(docsDir, "chatsdk-ios", "community-channels"), { recursive: true });
  await fs.mkdir(path.join(docsDir, "chatsdk-web", "community-channels"), { recursive: true });
  await fs.mkdir(path.join(docsDir, "chatsdk-ios", "channel"), { recursive: true });

  await fs.writeFile(
    path.join(docsDir, "chatsdk-android", "community-channels", "overview.md"),
    [
      "# Community channel overview",
      "",
      "Community channels are for large-scale real-time communication with no member limit.",
      "",
      "They support subchannels, including public and private subchannels, and help organize large communities.",
      "",
      "Create community channels by using the Server API from your app server instead of a client-side SDK create call.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsDir, "chatsdk-ios", "community-channels", "overview.md"),
    [
      "# Community channel overview",
      "",
      "Community channels are for large-scale real-time communication with no member limit.",
      "",
      "They support subchannels, including public and private subchannels, and help organize large communities.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsDir, "chatsdk-web", "community-channels", "overview.md"),
    [
      "# Community channel overview",
      "",
      "Community channels are for large-scale real-time communication with no member limit.",
      "",
      "They support subchannels, including public and private subchannels, and help organize large communities.",
      "",
    ].join("\n"),
    "utf-8",
  );
  for (const platform of ["android", "ios", "web"]) {
    await fs.writeFile(
      path.join(docsDir, `chatsdk-${platform}`, "community-channels", "creating-channel.md"),
      [
        "# Creating community channels",
        "",
        `The ${platform === "ios" ? "iOS" : platform === "web" ? "Web" : "Android"} Chat SDK does not provide client-side APIs for creating community channels or subchannels.`,
        "",
        "Use Server API from your app server to create the community channel, then return the channel information to the client.",
        "",
      ].join("\n"),
      "utf-8",
    );
  }
  await fs.writeFile(
    path.join(docsDir, "chatsdk-ios", "channel", "get.md"),
    [
      "# Get a single channel",
      "",
      "Call `BaseChannel.getChannels(identifiers:completion:)` to retrieve one or more specific channels.",
      "",
      "A direct channel is a one-to-one conversation whose channel ID is typically the target user ID.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsDir, "chatsdk-ios", "channel", "get-unread-message.md"),
    [
      "# Get the first unread message",
      "",
      "Call `getFirstUnreadMessage(completion:)` on a channel instance to inspect unread messages.",
      "",
      "Use a direct channel instance when you need unread-message access on iOS.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsDir, "chatsdk-android", "community-channels", "events.md"),
    [
      "# Community channel events",
      "",
      "Listen for community channel events in the Android Chat SDK.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsDir, "chatsdk-android", "community-channels", "do-not-disturb.md"),
    [
      "# Community channel do not disturb",
      "",
      "Configure DND behavior for community channels on Android.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

async function createOpenChannelFixtureDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-open-docs");
  const docsDir = path.join(docsRoot, "docs");
  await fs.mkdir(path.join(docsDir, "chatsdk-android", "community-channels"), { recursive: true });
  await fs.mkdir(path.join(docsDir, "chatsdk-android", "open-channels"), { recursive: true });

  await fs.writeFile(
    path.join(docsDir, "chatsdk-android", "community-channels", "overview.md"),
    [
      "# Community channel overview",
      "",
      "Community channels are designed for large-scale communication with subchannels and app-server-managed membership.",
      "",
      "They support private subchannels and user groups.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsDir, "chatsdk-android", "open-channels", "overview.md"),
    [
      "# Open channel overview",
      "",
      "Open channels provide high-concurrency messaging for unlimited online participants.",
      "",
      "They do not support offline push, and local messages are cleared when the user leaves the channel.",
      "",
    ].join("\n"),
    "utf-8",
  );

  return docsRoot;
}

async function createWebhookFixtureDocs(): Promise<string> {
  const docsRoot = await makeTempDir("doc-assistant-webhook-docs");
  await fs.mkdir(path.join(docsRoot, "docs", "platform-chat-api", "webhook", "events", "message"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-web", "community-channel"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-web", "message"), {
    recursive: true,
  });

  await fs.writeFile(
    path.join(docsRoot, "docs", "platform-chat-api", "webhook", "overview.md"),
    [
      "# Webhooks overview",
      "",
      "## Set up webhooks",
      "",
      "Open the Nexconn Console, go to Webhooks, click Config, enter the webhook URL, select the events, and save.",
      "",
      "## Verify signatures",
      "",
      "Verify the webhook signature before processing the callback payload.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "platform-chat-api", "webhook", "events", "message", "delete.md"),
    [
      "# Message delete webhook",
      "",
      "This event page describes the message delete payload.",
      "",
      "For the complete webhook setup and signature verification guide, see Webhooks overview.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-web", "community-channel", "group-member-manager.md"),
    [
      "# Set up group member manager",
      "",
      "Use this page to configure group member manager behavior in the Web Chat SDK.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-web", "message", "delete.md"),
    ["# Delete messages", "", "Delete a message for yourself or for all participants.", ""].join(
      "\n",
    ),
    "utf-8",
  );
  return docsRoot;
}

function makeMemoryEntry(params: {
  question: string;
  answer: string;
  summary?: string;
  reviewStatus: "pending_review" | "approved_standard" | "rejected";
  questionVariants?: string[];
}): AnswerMemoryEntry {
  const now = Date.now();
  const questionVariants = Array.from(
    new Set([params.question, ...(params.questionVariants ?? [])]),
  );
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/\bjavascript\b/g, "web")
      .replace(/\bjs\b/g, "web")
      .replace(/\bdirect chats?\b/g, "direct channel")
      .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  return {
    entryId: randomUUID(),
    question: params.question,
    normalizedQuestion: normalize(params.question),
    questionVariants,
    normalizedQuestionVariants: questionVariants.map((value) => normalize(value)),
    answer: params.answer,
    summary: params.summary ?? "memory answer",
    citations: [],
    mode: "extractive",
    reviewStatus: params.reviewStatus,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    hitCount: 1,
    provenance: "generated_from_docs",
  };
}

type Frame = DocAssistantResponse | DocAssistantEvent;

class MockWebSocket {
  OPEN = 1;
  readyState = 1;
  sentFrames: string[] = [];
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  private sendListeners: Array<(data: string) => void> = [];

  on(event: string, listener: (...args: unknown[]) => void): void {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
  }

  send(data: string): void {
    this.sentFrames.push(data);
    for (const listener of this.sendListeners) {
      listener(data);
    }
  }

  onSend(listener: (data: string) => void): void {
    this.sendListeners.push(listener);
  }

  receiveFromClient(data: string): void {
    const listeners = this.listeners.get("message") ?? [];
    for (const listener of listeners) {
      listener({ toString: () => data });
    }
  }

  close(): void {
    this.readyState = 3;
    const listeners = this.listeners.get("close") ?? [];
    for (const listener of listeners) {
      listener(1000, Buffer.from("closed"));
    }
  }
}

class RpcClient {
  private nextId = 1;
  private pending = new Map<string, (frame: DocAssistantResponse) => void>();
  private events: DocAssistantEvent[] = [];
  private waiters: Array<{
    event: string;
    resolve: (frame: DocAssistantEvent) => void;
    predicate?: (frame: DocAssistantEvent) => boolean;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(private readonly ws: MockWebSocket) {
    const processFrame = (raw: string) => {
      const frame = JSON.parse(raw) as Frame;
      if ("id" in frame) {
        const pending = this.pending.get(frame.id);
        if (pending) {
          this.pending.delete(frame.id);
          pending(frame);
        }
        return;
      }
      this.events.push(frame);
      const matched = this.waiters.find(
        (waiter) =>
          waiter.event === frame.event && (waiter.predicate ? waiter.predicate(frame) : true),
      );
      if (!matched) {
        return;
      }
      clearTimeout(matched.timer);
      this.waiters = this.waiters.filter((waiter) => waiter !== matched);
      matched.resolve(frame);
    };

    for (const frame of ws.sentFrames) {
      processFrame(frame);
    }
    ws.onSend(processFrame);
  }

  async request(method: string, params?: unknown): Promise<DocAssistantResponse> {
    const id = String(this.nextId++);
    return await new Promise<DocAssistantResponse>((resolve) => {
      this.pending.set(id, resolve);
      this.ws.receiveFromClient(JSON.stringify({ id, method, params }));
    });
  }

  async waitForEvent(
    event: string,
    predicate?: (frame: DocAssistantEvent) => boolean,
    timeoutMs = 4_000,
  ): Promise<DocAssistantEvent> {
    const existing = this.events.find(
      (frame) => frame.event === event && (predicate ? predicate(frame) : true),
    );
    if (existing) {
      return existing;
    }
    return await new Promise<DocAssistantEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.resolve !== resolve);
        reject(new Error(`Timed out waiting for event ${event}`));
      }, timeoutMs);
      this.waiters.push({ event, resolve, predicate, timer });
    });
  }

  getEvents(event: string): DocAssistantEvent[] {
    return this.events.filter((frame) => frame.event === event);
  }

  close(): void {
    this.ws.close();
  }
}

async function createHarness(params?: {
  docsRoot?: string;
  dataDir?: string;
  defaultMode?: "extractive" | "agent";
  adminToken?: string;
  wsToken?: string;
  defaultAgentConfig?: {
    backend?: "embedded" | "cli";
    provider?: string;
    model?: string;
  };
}) {
  const state = createDocAssistantRuntimeState({
    docsRoot: params?.docsRoot ?? resolveDefaultDocsRoot(),
    dataDir: params?.dataDir,
    defaultMode: params?.defaultMode ?? "extractive",
    adminToken: params?.adminToken,
    defaultAgentConfig: params?.defaultAgentConfig,
  });
  const router = createDocAssistantRouter();
  const ws = new MockWebSocket();
  handleConnection(
    ws as Parameters<typeof handleConnection>[0],
    params?.wsToken ? { token: params.wsToken } : {},
    state,
    router,
  );
  const client = new RpcClient(ws);
  await client.waitForEvent("docs.connected");
  return { state, router, client };
}

type UserCreateResult = {
  userId: string;
  sessionKey: string;
  createdAt: number;
};

type SearchPreviewResult = {
  query: string;
  hits: Array<{
    path: string;
    heading?: string;
    startLine: number;
    endLine: number;
    snippet: string;
    score: number;
  }>;
};

type TranscriptResult = {
  userId: string;
  sessionKey: string;
  sessionId: string;
  messages: Array<{
    role: string;
    content: unknown;
  }>;
};

type MethodsResult = {
  methods: Array<{
    method: string;
    description: string;
  }>;
};

type StatusResult = {
  status: string;
  version: string;
  packageVersion: string;
  docsRoot: string;
  defaultMode: "extractive" | "agent";
  dataDir: string;
  connections: number;
  activeRuns: number;
  terminalRuns: number;
  users: number;
  sessions: number;
  questionHistoryEntries: number;
  memoryEntries: number;
  pendingReviewEntries: number;
  approvedStandardEntries: number;
  uptime: number;
  serverTime: number;
};

function responseResult<T>(response: DocAssistantResponse): T {
  assert.equal(response.ok, true);
  return response.result as T;
}

function eventData<T>(event: DocAssistantEvent): T {
  return event.data as T;
}

void test("docs.user.create returns unique ids and stable session keys", async (t) => {
  const dataDir = await makeTempDir("doc-assistant-users");
  const { client } = await createHarness({ dataDir });
  t.after(() => client.close());

  const first = responseResult<UserCreateResult>(
    await client.request("docs.user.create", { displayLabel: "alpha" }),
  );
  const second = responseResult<UserCreateResult>(
    await client.request("docs.user.create", { displayLabel: "beta" }),
  );

  assert.notEqual(first.userId, second.userId);
  assert.equal(first.sessionKey, `temp/${first.userId}`);
  assert.equal(second.sessionKey, `temp/${second.userId}`);
});

void test("docs.search.preview returns heading-based citations from local docs", async (t) => {
  const dataDir = await makeTempDir("doc-assistant-search");
  const { client } = await createHarness({ dataDir });
  t.after(() => client.close());

  const result = responseResult<SearchPreviewResult>(
    await client.request("docs.search.preview", {
      query: "check node version node 24",
      maxResults: 3,
    }),
  );

  assert.equal(result.hits.length > 0, true);
  assert.equal(
    result.hits.some((hit) => hit.path === "docs/install/node.md"),
    true,
  );
  const nodeHit = result.hits.find((hit) => hit.path === "docs/install/node.md");
  assert.equal((nodeHit?.startLine ?? 0) > 0, true);
  assert.equal((nodeHit?.endLine ?? 0) >= (nodeHit?.startLine ?? 0), true);
});

void test("docs.methods and docs.status expose supported control-plane surfaces", async (t) => {
  const dataDir = await makeTempDir("doc-assistant-methods");
  const { client } = await createHarness({ dataDir });
  t.after(() => client.close());

  const methods = responseResult<MethodsResult>(await client.request("docs.methods"));
  assert.equal(
    methods.methods.some((entry) => entry.method === "docs.ask"),
    true,
  );
  assert.equal(
    methods.methods.some((entry) => entry.method === "docs.run.wait"),
    true,
  );
  assert.equal(
    methods.methods.some((entry) => entry.method === "docs.search.preview"),
    true,
  );
  assert.equal(
    methods.methods.some((entry) => entry.method === "docs.history.list"),
    true,
  );

  const status = responseResult<StatusResult>(await client.request("docs.status"));
  assert.equal(status.status, "running");
  assert.equal(status.version, "v0.1");
  assert.equal(status.packageVersion, "0.1.0");
  assert.equal(status.connections >= 1, true);
  assert.equal(status.activeRuns, 0);
  assert.equal(status.terminalRuns, 0);
  assert.equal(status.questionHistoryEntries, 0);
});

void test("search skips archive docs and prefers matching platform docs over other platforms", async () => {
  const docsRoot = await makeTempDir("doc-assistant-ranking");
  await fs.mkdir(path.join(docsRoot, "callsdk-ios"), { recursive: true });
  await fs.mkdir(path.join(docsRoot, "callsdk-web"), { recursive: true });
  await fs.mkdir(path.join(docsRoot, ".archive", "ios"), { recursive: true });

  await fs.writeFile(
    path.join(docsRoot, "callsdk-ios", "one-to-one-call.md"),
    "# Start a 1-to-1 call\n\nUse startCall and acceptCall for the iOS Call SDK.\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "callsdk-web", "one-to-one-call.md"),
    "# Start a call\n\nUse startCall and acceptCall for the Web Call SDK.\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, ".archive", "ios", "one-to-one-call.md"),
    "# Old guide\n\nArchived iOS call guide.\n",
    "utf-8",
  );

  const hits = await searchDocs({
    query: "How do I start and accept a 1-to-1 call in the iOS Call SDK?",
    docsRoot,
    maxResults: 3,
  });

  assert.equal(hits[0]?.path.endsWith("callsdk-ios/one-to-one-call.md"), true);
  assert.equal(hits[1]?.path.endsWith("callsdk-web/one-to-one-call.md"), true);
  assert.equal(
    hits.some((hit) => hit.path.includes(".archive/")),
    false,
  );
});

void test("search downweights partial docs when a product page matches", async () => {
  const docsRoot = await makeTempDir("doc-assistant-partials");
  await fs.mkdir(path.join(docsRoot, "callsdk-ios"), { recursive: true });
  await fs.mkdir(path.join(docsRoot, "partials", "shared"), { recursive: true });

  await fs.writeFile(
    path.join(docsRoot, "callsdk-ios", "push-config.md"),
    "# Configure push settings\n\nUse NCCallPushConfig and NCCallIOSPushConfig for iOS call push settings.\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "partials", "shared", "push.md"),
    "# Push properties\n\nShared push properties reference.\n",
    "utf-8",
  );

  const hits = await searchDocs({
    query: "How do I configure push settings for the iOS Call SDK?",
    docsRoot,
    maxResults: 2,
  });

  assert.equal(hits[0]?.path.endsWith("callsdk-ios/push-config.md"), true);
});

void test("search skips archive docs when the basename matches a primary doc", async () => {
  const docsRoot = await makeTempDir("doc-assistant-archive-tier");
  await fs.mkdir(path.join(docsRoot, "callsdk-ios"), { recursive: true });
  await fs.mkdir(path.join(docsRoot, ".archive", "zh-source", "ios-callplus"), { recursive: true });

  await fs.writeFile(
    path.join(docsRoot, "callsdk-ios", "callplus-voip.md"),
    "# Enable PushKit\n\nVoIP push in iOS CallPlus uses PushKit and CallKit.\n\n# Provisioning\n\nUse a distribution provisioning profile.\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, ".archive", "zh-source", "ios-callplus", "callplus-voip.md"),
    "# 旧版 VoIP 文档\n\nVoIP push also mentions distribution provisioning profile.\n",
    "utf-8",
  );

  const hits = await searchDocs({
    query: "What is required for VoIP push in iOS CallPlus?",
    docsRoot,
    maxResults: 3,
  });

  assert.equal(hits[0]?.path.endsWith("callsdk-ios/callplus-voip.md"), true);
  const primaryIndex = hits.findIndex((hit) => hit.path.endsWith("callsdk-ios/callplus-voip.md"));
  assert.equal(primaryIndex !== -1, true);
  assert.equal(
    hits.some((hit) => hit.path.includes(".archive/")),
    false,
  );
});

void test("search boosts requirement-oriented headings for requirement questions", async () => {
  const docsRoot = await makeTempDir("doc-assistant-heading-intent");
  await fs.mkdir(path.join(docsRoot, "callsdk-ios"), { recursive: true });

  await fs.writeFile(
    path.join(docsRoot, "callsdk-ios", "callplus-voip.md"),
    [
      "# Receive VoIP incoming call data",
      "",
      "Use the callback to receive incoming call information.",
      "",
      "# When to use VoIP PushKit",
      "",
      "Use PushKit and CallKit when your app needs faster wake-up behavior.",
      "",
      "# Provisioning requirements",
      "",
      "Use a distribution provisioning profile for production VoIP push.",
      "",
    ].join("\n"),
    "utf-8",
  );

  const hits = await searchDocs({
    query: "What is required for VoIP push in iOS CallPlus?",
    docsRoot,
    maxResults: 3,
  });

  assert.equal(hits[0]?.heading, "Provisioning requirements");
  assert.equal(hits[1]?.heading, "When to use VoIP PushKit");
});

void test("search downranks server sync docs for direct chat quickstart questions", async () => {
  const docsRoot = await makeTempDir("doc-assistant-direct-chat-ranking");
  await fs.mkdir(path.join(docsRoot, "platform-chat-api", "message"), { recursive: true });
  await fs.mkdir(path.join(docsRoot, "chatsdk-android"), { recursive: true });
  await fs.mkdir(path.join(docsRoot, "chatsdk-ios", "direct-system-channels"), { recursive: true });
  await fs.mkdir(path.join(docsRoot, "chatsdk-web", "message"), { recursive: true });

  await fs.writeFile(
    path.join(docsRoot, "platform-chat-api", "message", "how-to-sync-to-sender-client.md"),
    [
      "# Set the isEchoToSender parameter",
      "",
      "When calling a server API, set isEchoToSender to 1 to sync a sent message to the sender client.",
      "",
      "# Enable cloud message history storage",
      "",
      "Use message history when the sender is offline.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "chatsdk-android", "overview.md"),
    [
      "# Get started",
      "",
      "Start with the quickstart to import the SDK, initialize it, and send your first message.",
      "",
      "## Direct channel",
      "",
      "Direct channel means one-to-one private chat between two users.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "chatsdk-ios", "direct-system-channels", "overview.md"),
    [
      "# Channel overview",
      "",
      "A direct channel enables one-to-one messaging between two users.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "chatsdk-web", "message", "send.md"),
    [
      "# Send a message",
      "",
      "Use DirectChannel and SendTextMessageParams to send a text message.",
      "",
    ].join("\n"),
    "utf-8",
  );

  const hits = await searchDocs({
    query: "How to start a direct chat?",
    docsRoot,
    maxResults: 4,
  });

  assert.equal(hits[0]?.path.includes("chatsdk-"), true);
  assert.equal(hits[0]?.path.includes("platform-chat-api"), false);
  assert.equal(
    hits.slice(0, 3).every((hit) => !hit.path.includes("platform-chat-api")),
    true,
  );
});

void test("search keeps direct and group channel docs ahead of server and community noise for generic channel creation questions", async () => {
  const docsRoot = await makeTempDir("doc-assistant-channel-creation-ranking");
  await fs.mkdir(path.join(docsRoot, "platform-chat-api", "message"), { recursive: true });
  await fs.mkdir(path.join(docsRoot, "chatsdk-android", "direct-system-channels"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "chatsdk-ios", "group-channels"), { recursive: true });
  await fs.mkdir(path.join(docsRoot, "chatsdk-web", "community-channel"), { recursive: true });

  await fs.writeFile(
    path.join(docsRoot, "platform-chat-api", "message", "how-to-sync-to-sender-client.md"),
    [
      "# Enable cloud message history storage",
      "",
      "Use message history when the sender is offline.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "chatsdk-android", "direct-system-channels", "retrieving-channels.md"),
    [
      "# Retrieving channels",
      "",
      "The SDK maintains a channel list in the local database.",
      "",
      "## Get a specific channel",
      "",
      'Create `DirectChannel("userId")` and call `reload()` to get the latest direct channel state.',
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "chatsdk-ios", "group-channels", "manage-group-channel.md"),
    [
      "# Manage group channels",
      "",
      "## Create a group",
      "",
      "Call `GroupChannel.createGroup(params:completion:)` to create a group channel.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "chatsdk-web", "community-channel", "private-channel-about.md"),
    [
      "# Understanding private subchannels",
      "",
      "Use the Server API to create and manage private subchannels.",
      "",
    ].join("\n"),
    "utf-8",
  );

  const genericHits = await searchDocs({
    query: "How to create a channel?",
    docsRoot,
    maxResults: 4,
  });
  const directHits = await searchDocs({
    query: "How to create a direct channel?",
    docsRoot,
    maxResults: 4,
  });

  assert.equal(
    genericHits.slice(0, 3).some((hit) => hit.path.includes("direct-system-channels")),
    true,
  );
  assert.equal(
    genericHits.slice(0, 3).some((hit) => hit.path.includes("group-channels")),
    true,
  );
  assert.equal(genericHits[0]?.path.includes("platform-chat-api"), false);
  assert.equal(genericHits[0]?.path.includes("community-channel"), false);
  assert.equal(directHits[0]?.path.includes("direct-system-channels"), true);
  assert.equal(directHits[0]?.path.includes("community-channel"), false);
});

void test("search treats chat server connection questions as client SDK connection, not server API catalog", async () => {
  const docsRoot = await createClientConnectFixtureDocs();

  const hits = await searchDocs({
    query: "How to connect to the chat server?",
    docsRoot,
    maxResults: 4,
  });

  assert.equal(hits[0]?.path.includes("chatsdk-android/connection/connect.md"), true);
  assert.equal(hits[0]?.path.includes("platform-chat-api"), false);
  assert.equal(
    hits.slice(0, 2).every((hit) => hit.path.includes("/connection/connect.md")),
    true,
  );
  assert.equal(hits[0]?.heading, "Connect");
});

void test("search prefers webhook overview for generic webhook setup wording", async () => {
  const docsRoot = await createWebhookFixtureDocs();

  const hits = await searchDocs({
    query: "How to set up Webhook?",
    docsRoot,
    maxResults: 4,
  });

  assert.equal(hits[0]?.path.endsWith("docs/platform-chat-api/webhook/overview.md"), true);
  assert.equal(hits[0]?.heading, "Set up webhooks");
  assert.equal(
    hits.slice(0, 2).some((hit) => hit.path.includes("group-member-manager.md")),
    false,
  );
});

void test("search ignores filler wording and still prefers webhook overview", async () => {
  const docsRoot = await createWebhookFixtureDocs();

  const hits = await searchDocs({
    query: "Just let me know how to implement webhook",
    docsRoot,
    maxResults: 4,
  });

  assert.equal(hits[0]?.path.endsWith("docs/platform-chat-api/webhook/overview.md"), true);
  assert.equal(hits[0]?.heading, "Set up webhooks");
  assert.equal(
    hits.slice(0, 2).some((hit) => hit.path.endsWith("/message/delete.md")),
    false,
  );
});

void test("search prefers client send-message docs over sync-to-sender server docs", async () => {
  const docsRoot = await createSendMessageFixtureDocs();

  const hits = await searchDocs({
    query: "How to send a message?",
    docsRoot,
    maxResults: 6,
  });

  const androidIndex = hits.findIndex((hit) =>
    hit.path.endsWith("docs/chatsdk-android/message/send.md"),
  );
  const iosIndex = hits.findIndex((hit) => hit.path.endsWith("docs/chatsdk-ios/message/send.md"));
  const serverIndex = hits.findIndex((hit) =>
    hit.path.endsWith("docs/platform-chat-api/message/how-to-sync-to-sender-client.md"),
  );

  assert.equal(androidIndex !== -1, true);
  assert.equal(iosIndex !== -1, true);
  assert.equal(serverIndex === -1 || androidIndex < serverIndex, true);
  assert.equal(serverIndex === -1 || iosIndex < serverIndex, true);
});

void test("search still keeps quickstart-style entry points for generic first-message clarification", async () => {
  const docsRoot = await createSendMessageFixtureDocs();

  const hits = await searchDocs({
    query: "How to send my first message?",
    docsRoot,
    maxResults: 6,
  });

  assert.equal(
    hits.some((hit) => hit.path.endsWith("docs/chatsdk-android/getting-started.md")),
    true,
  );
  assert.equal(
    hits.some((hit) => hit.path.endsWith("docs/chatsdk-ios/quickstart.md")),
    true,
  );
});

void test("search prefers specialized send docs over quickstart steps once platform is explicit", async () => {
  const docsRoot = await createSendMessageFixtureDocs();

  const hits = await searchDocs({
    query: "How to send my first message on Android?",
    docsRoot,
    maxResults: 6,
  });

  const sendIndex = hits.findIndex((hit) =>
    hit.path.endsWith("docs/chatsdk-android/message/send.md"),
  );
  const stepIndex = hits.findIndex((hit) =>
    hit.path.endsWith("docs/chatsdk-android/getting-started.md"),
  );

  assert.equal(sendIndex !== -1, true);
  assert.equal(stepIndex !== -1, true);
  assert.equal(sendIndex < stepIndex, true);
});

void test("buildDocAnswer asks for platform clarification when multiple SDK platforms match", async () => {
  const result = await buildDocAnswer({
    runId: "clarify-1",
    question: "How to start a direct chat?",
    mode: "extractive",
    hits: [
      {
        path: "docs/chatsdk-android/overview.md",
        heading: "Get started",
        startLine: 10,
        endLine: 20,
        snippet: "Import the SDK, initialize it, and send your first message.",
        text: "Import the SDK, initialize it, and send your first message.",
        score: 90,
      },
      {
        path: "docs/chatsdk-ios/direct-system-channels/overview.md",
        heading: "Direct channel",
        startLine: 12,
        endLine: 24,
        snippet: "A direct channel enables one-to-one messaging between two users.",
        text: "A direct channel enables one-to-one messaging between two users.",
        score: 88,
      },
      {
        path: "docs/chatsdk-web/message/send.md",
        heading: "Send a message",
        startLine: 5,
        endLine: 18,
        snippet: "Use DirectChannel and SendTextMessageParams to send a text message.",
        text: "Use `DirectChannel` and `SendTextMessageParams` to send a text message.",
        score: 86,
      },
    ],
  });

  assert.equal(result.summary, "platform clarification required");
  assert.equal(result.answer.includes("Android"), true);
  assert.equal(result.answer.includes("iOS"), true);
  assert.equal(result.answer.includes("Web"), true);
  assert.equal(result.answer.includes("Please tell me"), false);
  assert.equal(result.answer.includes("This question depends on the target platform"), true);
  assert.equal(result.answer.includes("Relevant doc entry points"), true);
  assert.equal(result.answer.includes("我不应该直接猜平台"), false);
});

void test("buildDocAnswer asks for channel clarification when direct and group channel tracks compete", async () => {
  const result = await buildDocAnswer({
    runId: "clarify-channel-1",
    question: "How to create a channel?",
    mode: "extractive",
    hits: [
      {
        path: "docs/chatsdk-android/direct-system-channels/retrieving-channels.md",
        heading: "Get a specific channel",
        startLine: 14,
        endLine: 40,
        snippet: 'Create `DirectChannel("userId")` and call `reload()` to load the direct channel.',
        text: 'Create `DirectChannel("userId")` and call `reload()` to load the direct channel.',
        score: 92,
      },
      {
        path: "docs/chatsdk-ios/group-channels/manage-group-channel.md",
        heading: "Create a group",
        startLine: 84,
        endLine: 120,
        snippet: "Call `GroupChannel.createGroup(params:completion:)` to create a group channel.",
        text: "Call `GroupChannel.createGroup(params:completion:)` to create a group channel.",
        score: 90,
      },
      {
        path: "docs/chatsdk-web/community-channel/create.md",
        heading: "Create a subchannel",
        startLine: 15,
        endLine: 20,
        snippet: "Use the Server API to create a subchannel.",
        text: "Use the Server API to create a community channel subchannel.",
        score: 75,
      },
    ],
  });

  assert.equal(result.summary, "channel clarification required");
  assert.equal(result.answer.includes("direct channel"), true);
  assert.equal(result.answer.includes("group channel"), true);
  assert.equal(result.answer.includes("community channel / subchannel"), true);
  assert.equal(result.answer.includes("Relevant doc entry points"), true);
});

void test("buildDocAnswer asks for platform clarification on chat-server connection questions when SDK connection docs span platforms", async () => {
  const result = await buildDocAnswer({
    runId: "clarify-connect-1",
    question: "How to connect to the chat server?",
    mode: "extractive",
    hits: [
      {
        path: "docs/chatsdk-android/connection/connect.md",
        heading: "Connect",
        startLine: 1,
        endLine: 12,
        snippet: "Get an access token and call NCEngine.connect(...) on Android.",
        text: "Get an access token for the current user and call `NCEngine.connect(...)` on Android.",
        score: 96,
      },
      {
        path: "docs/chatsdk-ios/connection/connect.md",
        heading: "Connect",
        startLine: 1,
        endLine: 10,
        snippet: "Get an access token and connect to the chat server on iOS.",
        text: "Get an access token for the current user and connect to the chat server on iOS.",
        score: 94,
      },
      {
        path: "docs/platform-chat-api/chat-server-api-list.md",
        heading: "Channel management",
        startLine: 20,
        endLine: 30,
        snippet: "Use the Platform Chat API for server-side channel management.",
        text: "Use the Platform Chat API for server-side channel management.",
        score: 70,
      },
    ],
  });

  assert.equal(result.summary, "platform clarification required");
  assert.equal(result.answer.includes("target platform"), true);
  assert.equal(result.answer.includes("Android"), true);
  assert.equal(result.answer.includes("iOS"), true);
  assert.equal(result.answer.includes("community channel"), false);
  assert.equal(result.answer.includes("subchannel"), false);
});

void test("buildDocAnswer turns explicit-platform chat questions into a step guide", async () => {
  const result = await buildDocAnswer({
    runId: "guide-1",
    question: "How to start a direct chat on Android?",
    mode: "extractive",
    hits: [
      {
        path: "docs/chatsdk-android/import.md",
        heading: "Import the SDK",
        startLine: 1,
        endLine: 18,
        snippet: "Add the Chat SDK dependency to your Android project.",
        text: "Add the Chat SDK dependency to your Android project.",
        score: 92,
      },
      {
        path: "docs/chatsdk-android/init.md",
        heading: "Initialize the SDK",
        startLine: 1,
        endLine: 24,
        snippet:
          "Call `NCEngine.initialize()` before you connect to the server or use messaging features.",
        text: "Call `NCEngine.initialize()` before you connect to the server or use messaging features.",
        score: 91,
      },
      {
        path: "docs/chatsdk-android/direct-system-channels/overview.md",
        heading: "Direct channel",
        startLine: 20,
        endLine: 34,
        snippet: "A direct channel enables one-to-one messaging between two users.",
        text: 'A direct channel enables one-to-one messaging between two users. Create a `DirectChannel("userId")` instance.',
        score: 90,
      },
      {
        path: "docs/chatsdk-android/getting-started.md",
        heading: "Send your first message",
        startLine: 40,
        endLine: 80,
        snippet: "Connect to the server and send your first message.",
        text: "Connect to the server with a token. Then create `SendTextMessageParams` and call `channel.sendMessage(...)`.",
        score: 89,
      },
    ],
  });

  assert.equal(result.summary.startsWith("guided answer from "), true);
  assert.equal(result.answer.includes("What you need"), false);
  assert.equal(result.answer.includes("Steps"), true);
  assert.equal(result.answer.includes("Key APIs or docs"), true);
  assert.equal(result.answer.includes("根据本地文档"), false);
  assert.equal(result.answer.includes("当前命中的文档主要支持你"), false);
  assert.equal(result.answer.includes("`DirectChannel"), true);
  assert.equal(result.answer.includes("sendMessage"), true);
  assert.equal(result.answer.includes("\n1. "), false);
  assert.equal(result.answer.includes("token acquisition"), false);
  assert.equal(result.answer.includes("connection establishment"), false);
});

void test("buildDocAnswer does not turn connection status metadata into direct-chat steps", async () => {
  const result = await buildDocAnswer({
    runId: "direct-chat-ios-status-codes-1",
    question: "How to start a direct chat on iOS?",
    mode: "extractive",
    hits: [
      {
        path: "docs/chatsdk-ios/connection/connect.md",
        heading: "Connection status codes",
        startLine: 162,
        endLine: 190,
        snippet: "Connection status codes for iOS chat.",
        text: "Connection status codes for iOS chat clients.",
        score: 97,
      },
      {
        path: "docs/chatsdk-ios/quickstart.md",
        heading: "Step 2: Initialize the SDK",
        startLine: 65,
        endLine: 121,
        snippet: "Initialize the SDK before using chat features.",
        text: "Import the Chat SDK and call `NCEngine.initialize(_:)` before using chat features.",
        score: 96,
      },
      {
        path: "docs/chatsdk-ios/quickstart.md",
        heading: "Step 5: Send a message",
        startLine: 199,
        endLine: 255,
        snippet: "Create a direct channel and send the first message.",
        text: 'Create `DirectChannel("userId")`, build `SendTextMessageParams`, and call `channel.sendMessage(...)`.',
        score: 95,
      },
    ],
  });

  assert.equal(result.answer.includes("Connection status codes"), false);
  assert.equal(result.answer.includes("Complete this step as documented"), false);
  assert.equal(result.answer.includes("What you need"), false);
  assert.equal(result.answer.includes("\n1. "), false);
  assert.equal(result.answer.includes("`NCEngine.initialize(_:)`"), false);
  assert.equal(result.answer.includes("`NCEngine.initialize`"), false);
});

void test("buildDocAnswer keeps generic send-message questions as platform clarification answers", async () => {
  const docsRoot = await createSendMessageFixtureDocs();
  const hits = await searchDocs({
    query: "How to send a message?",
    docsRoot,
    maxResults: 6,
  });

  const result = await buildDocAnswer({
    runId: "send-clarify-1",
    question: "How to send a message?",
    mode: "extractive",
    hits,
  });

  assert.equal(result.summary, "platform clarification required");
  assert.equal(result.answer.includes("Android"), true);
  assert.equal(result.answer.includes("iOS"), true);
  assert.equal(result.answer.includes("Steps"), false);
  assert.equal(result.answer.includes("DirectChannel"), false);
  assert.equal(result.answer.includes("start a direct chat"), false);
  assert.equal(result.answer.includes("import or initialization"), false);
  assert.equal(result.answer.includes("token acquisition"), false);
});

void test("buildDocAnswer renders explicit-platform send-message questions as send guides instead of chat-start guides", async () => {
  const docsRoot = await createSendMessageFixtureDocs();
  const hits = await searchDocs({
    query: "How to send a message on Android?",
    docsRoot,
    maxResults: 6,
  });

  const result = await buildDocAnswer({
    runId: "send-android-1",
    question: "How to send a message on Android?",
    mode: "extractive",
    hits,
  });

  assert.equal(result.summary.startsWith("guided answer from "), true);
  assert.equal(
    result.answer.includes("send a message on Android") ||
      result.answer.includes("send a text message on Android"),
    true,
  );
  assert.equal(result.answer.includes("start a direct chat"), false);
  assert.equal(result.answer.includes("DirectChannel"), false);
  assert.equal(result.answer.includes("SendTextMessageParams"), true);
  assert.equal(result.answer.includes("Steps"), true);
});

void test("buildDocAnswer keeps image-message answers subtype-specific", async () => {
  const docsRoot = await createSendMessageFixtureDocs();
  const hits = await searchDocs({
    query: "How to send an image message on Android?",
    docsRoot,
    maxResults: 6,
  });

  const result = await buildDocAnswer({
    runId: "send-image-1",
    question: "How to send an image message on Android?",
    mode: "extractive",
    hits,
  });

  assert.equal(result.summary.startsWith("guided answer from "), true);
  assert.equal(result.answer.includes("send an image message on Android"), true);
  assert.equal(result.answer.includes("SendImageMessageParams"), true);
  assert.equal(result.answer.includes("SendTextMessageParams"), false);
  assert.equal(result.answer.includes("start a direct chat"), false);
  assert.equal(
    result.citations.some((citation) => citation.heading === "Send an image message"),
    true,
  );
});

void test("buildDocAnswer makes quickstart-step send answers explicit about tutorial context", async () => {
  const result = await buildDocAnswer({
    runId: "send-quickstart-shape-1",
    question: "How to send my first message on Android?",
    mode: "extractive",
    hits: [
      {
        path: "docs/chatsdk-android/getting-started.md",
        heading: "Step 5: Send a message",
        startLine: 20,
        endLine: 36,
        snippet:
          "Build `SendTextMessageParams` and call `channel.sendMessage(...)` to send your first Android message.",
        text: "Build `SendTextMessageParams` and call `channel.sendMessage(...)` to send your first Android message. For more details, continue with the dedicated message docs.",
        score: 90,
        docShape: "quickstart_step",
      },
    ],
  });

  assert.equal(result.answer.includes("quickstart"), true);
  assert.equal(result.answer.includes("entry point"), true);
  assert.equal(result.answer.includes("full standalone"), false);
});

void test("search prefers community overview docs for concept questions", async () => {
  const docsRoot = await createCommunityChannelFixtureDocs();

  const hits = await searchDocs({
    query: "What is community channel?",
    docsRoot,
    maxResults: 5,
  });

  assert.equal(hits[0]?.path.endsWith("docs/chatsdk-android/community-channels/overview.md"), true);
  assert.equal(hits[0]?.retrievalBucket, "concept");
  const overviewIndex = hits.findIndex((hit) =>
    hit.path.endsWith("docs/chatsdk-android/community-channels/overview.md"),
  );
  const creatingIndex = hits.findIndex((hit) => hit.path.endsWith("creating-channel.md"));
  const eventsIndex = hits.findIndex((hit) => hit.path.endsWith("events.md"));
  const dndIndex = hits.findIndex((hit) => hit.path.endsWith("do-not-disturb.md"));
  assert.equal(overviewIndex !== -1, true);
  assert.equal(creatingIndex === -1 || overviewIndex < creatingIndex, true);
  assert.equal(eventsIndex === -1 || overviewIndex < eventsIndex, true);
  assert.equal(dndIndex === -1 || overviewIndex < dndIndex, true);
});

void test("search prefers open channel overview docs for open-channel concept questions", async () => {
  const docsRoot = await createOpenChannelFixtureDocs();

  const hits = await searchDocs({
    query: "what about open channel?",
    docsRoot,
    maxResults: 5,
  });

  assert.equal(hits[0]?.path.endsWith("docs/chatsdk-android/open-channels/overview.md"), true);
  const openOverviewIndex = hits.findIndex((hit) =>
    hit.path.endsWith("docs/chatsdk-android/open-channels/overview.md"),
  );
  const communityOverviewIndex = hits.findIndex((hit) =>
    hit.path.endsWith("docs/chatsdk-android/community-channels/overview.md"),
  );
  assert.equal(openOverviewIndex, 0);
  assert.equal(communityOverviewIndex === -1 || openOverviewIndex < communityOverviewIndex, true);
});

void test("search keeps creation workflow docs ahead of overview for procedural community queries", async () => {
  const docsRoot = await createCommunityChannelFixtureDocs();

  const hits = await searchDocs({
    query: "How to create a community channel?",
    docsRoot,
    maxResults: 5,
  });

  assert.equal(hits[0]?.path.endsWith("creating-channel.md"), true);
  assert.equal(hits[0]?.retrievalBucket, "procedural");
  assert.equal(
    hits.some((hit) => hit.path.endsWith("docs/chatsdk-android/community-channels/overview.md")),
    true,
  );
});

void test("mixed community queries preserve both concept and procedural retrieval buckets", async () => {
  const docsRoot = await createCommunityChannelFixtureDocs();

  const hits = await searchDocs({
    query: "What is community channel ?How to create a community channel?",
    docsRoot,
    maxResults: 5,
  });

  assert.equal(
    hits.some((hit) => hit.retrievalBucket === "concept"),
    true,
  );
  assert.equal(
    hits.some((hit) => hit.retrievalBucket === "procedural"),
    true,
  );
  assert.equal(
    hits.some(
      (hit) =>
        hit.retrievalBucket === "concept" &&
        hit.path.endsWith("docs/chatsdk-android/community-channels/overview.md"),
    ),
    true,
  );
  assert.equal(
    hits.some(
      (hit) => hit.retrievalBucket === "procedural" && hit.path.endsWith("creating-channel.md"),
    ),
    true,
  );
});

void test("planDocQuestion carries the first concept referent into a later pronoun step", () => {
  const plan = planDocQuestion("What is community channel? How to get it?");

  assert.equal(plan.kind, "mixed");
  assert.equal(plan.steps[0]?.question, "What is community channel");
  assert.equal(plan.steps[1]?.question, "How to get community channel");
  assert.equal(plan.steps[1]?.intent, "procedural");
});

void test("mixed pronoun queries keep community docs ahead of generic channel get pages", async () => {
  const docsRoot = await createCommunityChannelFixtureDocs();

  const hits = await searchDocs({
    query: "What is community channel? How to get it?",
    docsRoot,
    maxResults: 6,
  });

  const communityProceduralIndex = hits.findIndex(
    (hit) =>
      hit.retrievalBucket === "procedural" &&
      (hit.path.endsWith("docs/chatsdk-android/community-channels/creating-channel.md") ||
        hit.path.endsWith("docs/chatsdk-ios/community-channels/creating-channel.md") ||
        hit.path.endsWith("docs/chatsdk-web/community-channels/creating-channel.md") ||
        hit.path.endsWith("docs/chatsdk-android/community-channels/overview.md")),
  );
  const directGetIndex = hits.findIndex((hit) =>
    hit.path.endsWith("docs/chatsdk-ios/channel/get.md"),
  );

  assert.equal(communityProceduralIndex !== -1, true);
  assert.equal(directGetIndex === -1 || communityProceduralIndex < directGetIndex, true);
  assert.equal(
    hits.some((hit) => hit.path.endsWith("docs/chatsdk-android/community-channels/overview.md")),
    true,
  );
});

void test("buildDocAnswer turns webhook questions into a direct configuration guide", async () => {
  const result = await buildDocAnswer({
    runId: "guide-webhook-1",
    question: "Just let me know how to implement webhook",
    mode: "extractive",
    hits: [
      {
        path: "docs/platform-chat-api/webhook/overview.md",
        heading: "Set up webhooks",
        startLine: 3,
        endLine: 6,
        snippet:
          "Open the Nexconn Console, go to Webhooks, click Config, enter the webhook URL, select the events, and save.",
        text: "Open the Nexconn Console, go to Webhooks, click Config, enter the webhook URL, select the events, and save.",
        score: 120,
      },
      {
        path: "docs/platform-chat-api/webhook/overview.md",
        heading: "Verify signatures",
        startLine: 7,
        endLine: 9,
        snippet: "Verify the webhook signature before processing the callback payload.",
        text: "Verify the webhook signature before processing the callback payload.",
        score: 108,
      },
    ],
  });

  assert.equal(result.summary.startsWith("guided answer from "), true);
  assert.equal(
    result.answer.includes("Use the documented flow below to configure webhooks."),
    true,
  );
  assert.equal(result.answer.includes("Open the Webhooks settings, click Config"), true);
  assert.equal(result.answer.includes("Verify the webhook signature"), true);
  assert.equal(result.answer.includes("token acquisition"), false);
  assert.equal(result.answer.includes("send-message example"), false);
});

void test("buildDocAnswer uses open channel evidence instead of community definitions", async () => {
  const result = await buildDocAnswer({
    runId: "concept-open-channel-1",
    question: "what about open channel?",
    mode: "extractive",
    hits: [
      {
        path: "docs/chatsdk-android/open-channels/overview.md",
        heading: "Open channel overview",
        startLine: 6,
        endLine: 12,
        snippet:
          "Open channels provide high-concurrency messaging for unlimited online participants.",
        text: "Open channels provide high-concurrency messaging for unlimited online participants. They do not support offline push, and local messages are cleared when the user leaves the channel.",
        score: 120,
      },
      {
        path: "docs/chatsdk-android/community-channels/overview.md",
        heading: "Community channel overview",
        startLine: 6,
        endLine: 12,
        snippet:
          "Community channels are designed for large-scale communication with subchannels and app-server-managed membership.",
        text: "Community channels are designed for large-scale communication with subchannels and app-server-managed membership. They support private subchannels and user groups.",
        score: 116,
      },
    ],
  });

  assert.equal(result.answer.includes("Open channels provide high-concurrency messaging"), true);
  assert.equal(result.answer.includes("Community channels are designed"), false);
  assert.equal(
    result.citations[0]?.path.endsWith("docs/chatsdk-android/open-channels/overview.md"),
    true,
  );
});

void test("buildDocAnswer turns concept questions into an explanation instead of a step guide", async () => {
  const result = await buildDocAnswer({
    runId: "concept-1",
    question: "what's offline messages?",
    mode: "extractive",
    hits: [
      {
        path: "rc-new-docs/chatsdk-web/message/manage-offline-message-duration.mdx",
        heading: "About offline messages",
        startLine: 17,
        endLine: 25,
        snippet:
          "An offline message is a message received while the user is not online. The server automatically retains messages during the user's offline period.",
        text: "An offline message is a message received while the user is not online. The Nexconn server automatically retains messages received during the user's offline period.",
        score: 98,
      },
      {
        path: "rc-new-docs/guides/glossary/chat-glossary.mdx",
        heading: "Offline messages",
        startLine: 200,
        endLine: 211,
        snippet:
          "Messages delivered to a user while they were not connected. Nexconn retains undelivered messages for 7 days.",
        text: "Messages delivered to a user while they were not connected. Nexconn retains undelivered messages for 7 days. When the recipient reconnects within that window, Nexconn pushes the messages on reconnection.",
        score: 95,
      },
      {
        path: "rc-new-docs/chatsdk-web/message/manage-offline-message-duration.mdx",
        heading: "App-level offline message settings",
        startLine: 26,
        endLine: 35,
        snippet:
          "You can modify the offline message cloud retention period in the Nexconn Console.",
        text: "You can modify the offline message cloud retention period in the Nexconn Console. This setting controls how long messages are kept while a user is offline.",
        score: 90,
      },
    ],
  });

  assert.equal(result.summary.startsWith("concept answer from "), true);
  assert.equal(result.answer.includes("Definition"), true);
  assert.equal(result.answer.includes("Key points"), true);
  assert.equal(
    result.answer.includes("offline message is a message received while the user is not online"),
    true,
  );
  assert.equal(result.answer.includes("retains") || result.answer.includes("retention"), true);
  assert.equal(result.answer.includes("Steps"), false);
  assert.equal(result.answer.includes("What you need"), false);
});

void test("buildDocAnswer refuses concept answers when docs only mention the term incidentally", async () => {
  const result = await buildDocAnswer({
    runId: "concept-weak-1",
    question: "what is Nexconn",
    mode: "extractive",
    hits: [
      {
        path: "docs/chatsdk-ios/connection/disconnect.md",
        heading: "Disconnect and disable push",
        startLine: 72,
        endLine: 96,
        snippet:
          "Use this when signing out or switching app user accounts. Disconnecting with push disabled prevents push notifications from being delivered to the signed-out account.",
        text: "Use this when signing out or switching app user accounts. Disconnecting with push disabled prevents push notifications from being delivered to the signed-out account. Nexconn uses this behavior when a user signs out.",
        score: 88,
      },
    ],
  });

  assert.equal(result.summary, "no relevant documentation found");
  assert.equal(result.citations.length, 0);
  assert.equal(
    result.answer.includes("I couldn't find reliable local documentation that directly defines"),
    true,
  );
  assert.equal(result.answer.includes("Disconnect and disable push"), false);
});

void test("buildDocAnswer refuses overview pages that only mention the concept term incidentally", async () => {
  const result = await buildDocAnswer({
    runId: "concept-weak-2",
    question: "what is Nexconn",
    mode: "extractive",
    hits: [
      {
        path: "docs/chatsdk-android/group-channels/overview.md",
        heading: "Group channel overview",
        startLine: 6,
        endLine: 16,
        snippet:
          "Group channels are a common multi-user messaging pattern in chat apps. Nexconn group channels support member management, muting, offline push notifications, and message history sync.",
        text: "Group channels are a common multi-user messaging pattern in chat apps. Nexconn group channels support member management, muting, offline push notifications, and message history sync.",
        score: 53,
      },
    ],
  });

  assert.equal(result.summary, "no relevant documentation found");
  assert.equal(result.citations.length, 0);
  assert.equal(result.answer.includes("directly defines"), true);
});

void test("executeDocQuestion returns insufficient evidence when push language anchors are not covered", async () => {
  const docsRoot = await createPushLanguageDriftFixtureDocs();

  const result = await executeDocQuestion({
    runId: "push-language-1",
    question: "How to change the default language for push notification?",
    mode: "extractive",
    docsRoot,
    maxResults: 5,
  });

  assert.equal(result.route, "search");
  assert.equal(result.answer.summary, "insufficient documentation evidence");
  assert.equal(result.answer.answer.includes("enough evidence"), true);
  assert.equal(result.answer.answer.includes("intent-filter"), false);
  assert.equal(result.hits.length > 0, true);
});

void test("search prefers push language docs over adjacent push notification pages", async () => {
  const docsRoot = await createPushLanguageCoverageFixtureDocs();

  const hits = await searchDocs({
    query: "How to change the default language for push notification?",
    docsRoot,
    maxResults: 3,
  });

  assert.equal(hits[0]?.path.endsWith("set-push-notification-language.md"), true);
  assert.equal(hits[0]?.heading, "Set push notification language");
  assert.equal(
    hits.some((hit) => hit.path.endsWith("handle-push-notification-click.md")),
    true,
  );
});

void test("buildDocAnswer accepts overview pages as concept evidence", async () => {
  const result = await buildDocAnswer({
    runId: "concept-community-overview-1",
    question: "What is community channel?",
    mode: "extractive",
    hits: [
      {
        path: "docs/chatsdk-android/community-channels/overview.md",
        heading: "Community channel overview",
        startLine: 1,
        endLine: 8,
        snippet:
          "Community channels are for large-scale real-time communication with no member limit.",
        text: "Community channels are for large-scale real-time communication with no member limit. They support subchannels, including public and private subchannels. Create community channels by using the Server API from your app server instead of a client-side SDK create call.",
        score: 120,
        retrievalBucket: "concept",
      },
    ],
  });

  assert.equal(result.summary.startsWith("concept answer from "), true);
  assert.equal(result.answer.includes("Definition"), true);
  assert.equal(result.answer.includes("large-scale real-time communication"), true);
  assert.equal(result.answer.includes("Sources:"), true);
});

void test("buildDocAnswer does not turn mixed community pronoun questions into a direct-chat guide", async () => {
  const docsRoot = await createCommunityChannelFixtureDocs();
  const hits = await searchDocs({
    query: "What is community channel? How to get it?",
    docsRoot,
    maxResults: 6,
  });

  const result = await buildDocAnswer({
    runId: "mixed-community-pronoun-1",
    question: "What is community channel? How to get it?",
    mode: "extractive",
    hits,
  });

  assert.equal(result.summary === "no relevant documentation found", false);
  assert.equal(result.answer.includes("Definition"), true);
  assert.equal(result.answer.includes("start a direct chat"), false);
  assert.equal(result.answer.includes("DirectChannel"), false);
  assert.equal(
    result.answer.includes("Community channels are for large-scale real-time communication"),
    true,
  );
});

void test("buildDocAnswer returns definition first and partial steps for mixed community questions", async () => {
  const result = await buildDocAnswer({
    runId: "mixed-community-1",
    question: "What is community channel ?How to create a community channel?",
    mode: "extractive",
    hits: [
      {
        path: "docs/chatsdk-android/community-channels/overview.md",
        heading: "Community channel overview",
        startLine: 1,
        endLine: 6,
        snippet:
          "Community channels are for large-scale real-time communication with no member limit.",
        text: "Community channels are for large-scale real-time communication with no member limit. They support subchannels, including public and private subchannels.",
        score: 130,
        retrievalBucket: "concept",
      },
      {
        path: "docs/chatsdk-android/community-channels/creating-channel.md",
        heading: "Creating community channels",
        startLine: 1,
        endLine: 8,
        snippet:
          "The Android Chat SDK does not provide client-side APIs for creating community channels or subchannels. Use Server API from your app server.",
        text: "The Android Chat SDK does not provide client-side APIs for creating community channels or subchannels. Use Server API from your app server to create the community channel, then return the channel information to the client.",
        score: 125,
        retrievalBucket: "procedural",
      },
      {
        path: "docs/chatsdk-ios/community-channels/creating-channel.md",
        heading: "Creating community channels",
        startLine: 1,
        endLine: 8,
        snippet:
          "The iOS Chat SDK does not provide client-side APIs for creating community channels or subchannels. Use Server API from your app server.",
        text: "The iOS Chat SDK does not provide client-side APIs for creating community channels or subchannels. Use Server API from your app server to create the community channel, then return the channel information to the client.",
        score: 118,
        retrievalBucket: "procedural",
      },
    ],
  });

  assert.equal(result.summary, "platform clarification required");
  assert.equal(result.answer.includes("Definition"), true);
  assert.equal(result.answer.includes("Steps"), true);
  assert.equal(
    result.answer.includes("Community channels are for large-scale real-time communication"),
    true,
  );
  assert.equal(
    result.answer.includes("Community channels and subchannels are created via Server API"),
    true,
  );
  assert.equal(result.answer.includes("Choose Android / iOS"), true);
  assert.equal(result.answer.includes("no relevant documentation found"), false);
});

void test("detectGreetingIntent only intercepts narrow greeting and small-talk inputs", () => {
  assert.equal(detectGreetingIntent("你好")?.kind, "greeting");
  assert.equal(detectGreetingIntent("Hello")?.kind, "greeting");
  assert.equal(detectGreetingIntent("Hi")?.kind, "greeting");
  assert.equal(detectGreetingIntent("你是谁")?.kind, "assistant_intro");
  assert.equal(detectGreetingIntent("你能做什么")?.kind, "assistant_intro");
  assert.equal(detectGreetingIntent("谢谢")?.kind, "small_talk");
  assert.equal(detectGreetingIntent("How to start a direct chat on Android?"), null);
  assert.equal(detectGreetingIntent("你好，Android 怎么初始化 Chat SDK？"), null);
});

void test("clarification follow-up detection only intercepts short platform-only replies", () => {
  assert.deepEqual(detectClarificationFollowUpQuestion("Android"), { platform: "android" });
  assert.deepEqual(detectClarificationFollowUpQuestion("我要找android的"), { platform: "android" });
  assert.deepEqual(detectClarificationFollowUpQuestion("那 Android 呢"), { platform: "android" });
  assert.deepEqual(detectClarificationFollowUpQuestion("iOS 的"), { platform: "ios" });
  assert.deepEqual(detectClarificationFollowUpQuestion("web 版本"), { platform: "web" });
  assert.equal(detectClarificationFollowUpQuestion("Android 怎么初始化 Chat SDK？"), null);
  assert.equal(detectClarificationFollowUpQuestion("你好，Android 怎么初始化 Chat SDK？"), null);
  assert.equal(rewriteClarificationQuestion("How to chat?", "android"), "How to chat on Android?");
});

void test("clarification reuse heuristic only reuses when the prior retrieval has enough platform hits", async () => {
  const reuseDocs = await createClarificationReuseFixtureDocs();
  const reuseHits = await searchDocs({
    query: "How to chat?",
    docsRoot: reuseDocs,
    maxResults: 5,
  });
  assert.equal(
    shouldReuseClarificationHits(
      {
        hits: reuseHits,
        taskKind: "start_chat",
        preferredDocShape: "quickstart_step",
        originalTopHitShapes: reuseHits
          .slice(0, 3)
          .map((hit) => hit.docShape ?? "generic_reference"),
      },
      "android",
    ),
    true,
  );

  const rewriteDocs = await createClarificationRewriteFixtureDocs();
  const rewriteHits = await searchDocs({
    query: "How to chat?",
    docsRoot: rewriteDocs,
    maxResults: 5,
  });
  assert.equal(
    shouldReuseClarificationHits(
      {
        hits: rewriteHits,
        taskKind: "start_chat",
        preferredDocShape: "specialized_task",
        originalTopHitShapes: rewriteHits
          .slice(0, 3)
          .map((hit) => hit.docShape ?? "generic_reference"),
      },
      "android",
    ),
    false,
  );
});

void test("docs.ask greeting inputs skip retrieval and return a guided welcome answer", async (t) => {
  const docsRoot = await createGreetingFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-greeting");
  const { client } = await createHarness({ docsRoot, dataDir });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));
  const accepted = responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "你好",
      idempotencyKey: "greeting-run-1",
      mode: "extractive",
    }),
  );
  assert.equal(accepted.status, "accepted");

  const terminal = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "greeting-run-1";
    }),
  );
  assert.equal(terminal.status, "ok");
  assert.equal(terminal.summary, "guided greeting");
  assert.deepEqual(terminal.citations, []);
  assert.equal(terminal.answer.includes("我是你的 Nexconn 文档助手"), true);
  assert.equal(terminal.answer.includes("Android / iOS / Web Chat SDK 怎么接入和初始化"), true);
  assert.equal(terminal.answer.includes("Android Chat SDK 如何初始化并开始单聊"), true);
  assert.equal(terminal.answer.includes("iOS Call SDK 如何发起或接听 1 对 1 通话"), true);
  assert.equal(
    client
      .getEvents("docs.retrieval")
      .filter((frame) => eventData<{ runId?: string }>(frame).runId === "greeting-run-1").length,
    0,
  );
  assert.equal(
    client
      .getEvents("docs.delta")
      .filter((frame) => eventData<{ runId?: string }>(frame).runId === "greeting-run-1").length,
    0,
  );

  const transcript = responseResult<TranscriptResult>(
    await client.request("docs.session.transcript.get", { userId: user.userId }),
  );
  assert.equal(transcript.messages[0]?.role, "user");
  assert.equal(transcript.messages.at(-1)?.role, "assistant");
  assert.equal(
    String(transcript.messages.at(-1)?.content).includes("我是你的 Nexconn 文档助手"),
    true,
  );

  const history = responseResult<{
    total: number;
    entries: Array<{
      answered: boolean;
      answerOutcome: string;
      citationCount: number;
    }>;
  }>(await client.request("docs.history.list", { userId: user.userId }));
  assert.equal(history.total, 1);
  assert.equal(history.entries[0]?.answered, true);
  assert.equal(history.entries[0]?.answerOutcome, "guided_greeting");
  assert.equal(history.entries[0]?.citationCount, 0);
});

void test("docs.ask English greeting inputs return an English guided welcome answer", async (t) => {
  const docsRoot = await createGreetingFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-greeting-en");
  const { client } = await createHarness({ docsRoot, dataDir });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));
  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "Hello",
      idempotencyKey: "greeting-en-run-1",
      mode: "extractive",
    }),
  );

  const terminal = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "greeting-en-run-1";
    }),
  );
  assert.equal(terminal.summary, "guided greeting");
  assert.equal(terminal.answer.includes("I'm your Nexconn documentation assistant"), true);
  assert.equal(
    terminal.answer.includes(
      "How do I integrate and initialize the Android, iOS, or Web Chat SDK?",
    ),
    true,
  );
  assert.equal(
    terminal.answer.includes("How do I start or accept a 1-to-1 call in the iOS Call SDK?"),
    true,
  );
  assert.equal(terminal.answer.includes("For example:"), true);
});

void test("docs.ask in extractive mode accepts immediately, completes, and persists transcript", async (t) => {
  const docsRoot = await createLifecycleFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-extractive");
  const { client } = await createHarness({ docsRoot, dataDir });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));

  const accepted = responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "How do I check my Node version?",
      idempotencyKey: "extractive-run-1",
      mode: "extractive",
    }),
  );
  assert.equal(accepted.status, "accepted");

  const retrieval = eventData<{ runId: string; hits: unknown[] }>(
    await client.waitForEvent(
      "docs.retrieval",
      (frame) => {
        const data = eventData<{ runId: string }>(frame);
        return data.runId === "extractive-run-1";
      },
      25_000,
    ),
  );
  assert.equal(retrieval.runId, "extractive-run-1");
  assert.equal(retrieval.hits.length > 0, true);

  const terminal = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "extractive-run-1";
    }),
  );
  assert.equal(terminal.status, "ok");
  assert.equal(terminal.mode, "extractive");
  assert.equal(terminal.answer.includes("Sources:"), true);
  assert.equal(terminal.answer.toLowerCase().includes("node"), true);
  assert.equal(
    terminal.citations.some((citation) => citation.path.endsWith("node.md")),
    true,
  );

  const transcript = responseResult<TranscriptResult>(
    await client.request("docs.session.transcript.get", { userId: user.userId }),
  );
  assert.equal(transcript.messages.length >= 2, true);
  assert.equal(transcript.messages[0]?.role, "user");
  assert.equal(transcript.messages.at(-1)?.role, "assistant");

  const history = responseResult<{
    total: number;
    entries: Array<{
      userId: string;
      question: string;
      answered: boolean;
      answerOutcome: string;
    }>;
  }>(await client.request("docs.history.list"));
  assert.equal(history.total, 1);
  assert.equal(history.entries[0]?.userId, user.userId);
  assert.equal(history.entries[0]?.answered, true);
  assert.equal(history.entries[0]?.answerOutcome, "answered");
});

void test("docs.ask continues a clarification with an Android follow-up by reusing prior retrieval", async (t) => {
  const docsRoot = await createClarificationReuseFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-followup-reuse");
  const { client } = await createHarness({ docsRoot, dataDir });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));

  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "How to chat?",
      idempotencyKey: "followup-reuse-clarify",
      mode: "extractive",
    }),
  );

  const clarification = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "followup-reuse-clarify";
    }),
  );
  assert.equal(clarification.summary, "platform clarification required");

  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "我要找android的",
      idempotencyKey: "followup-reuse-answer",
      mode: "extractive",
    }),
  );

  const terminal = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "followup-reuse-answer";
    }),
  );
  assert.equal(terminal.status, "ok");
  assert.equal(terminal.summary.startsWith("guided answer from "), true);
  assert.equal(terminal.followUpSource, "clarification_reuse");
  assert.equal(terminal.continuedFromRunId, "followup-reuse-clarify");
  assert.equal(terminal.rewrittenQuestion, "How to chat on Android?");
  assert.equal(terminal.answer.includes("Android"), true);
  assert.equal(terminal.answer.includes("步骤"), true);
  assert.equal(terminal.answer.includes("我没有在本地 Markdown 文档库里找到"), false);
  assert.equal(terminal.answer.includes("平台相关的问题"), false);

  const history = responseResult<{
    entries: Array<{
      question: string;
      followUpSource?: string;
      rewrittenQuestion?: string;
      continuedFromRunId?: string;
      answered: boolean;
    }>;
  }>(await client.request("docs.history.list", { userId: user.userId }));
  assert.equal(history.entries[0]?.question, "我要找android的");
  assert.equal(history.entries[0]?.followUpSource, "clarification_reuse");
  assert.equal(history.entries[0]?.rewrittenQuestion, "How to chat on Android?");
  assert.equal(history.entries[0]?.continuedFromRunId, "followup-reuse-clarify");
  assert.equal(history.entries[0]?.answered, true);
});

void test("docs.ask can continue a clarification by rewriting the question and rerunning retrieval", async (t) => {
  const docsRoot = await createClarificationRewriteFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-followup-rewrite");
  const { client } = await createHarness({ docsRoot, dataDir });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));

  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "How to chat?",
      idempotencyKey: "followup-rewrite-clarify",
      mode: "extractive",
    }),
  );
  const clarification = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "followup-rewrite-clarify";
    }),
  );
  assert.equal(clarification.summary, "platform clarification required");

  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "Android",
      idempotencyKey: "followup-rewrite-answer",
      mode: "extractive",
    }),
  );
  const terminal = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "followup-rewrite-answer";
    }),
  );
  assert.equal(terminal.status, "ok");
  assert.equal(terminal.followUpSource, "clarification_rewrite");
  assert.equal(terminal.continuedFromRunId, "followup-rewrite-clarify");
  assert.equal(terminal.rewrittenQuestion, "How to chat on Android?");
  assert.equal(terminal.summary.includes("clarification"), false);
  assert.equal(terminal.summary.includes("no relevant"), false);
  assert.equal(terminal.answer.includes("我没有在本地 Markdown 文档库里找到"), false);
});

void test("first-message clarification follow-up reruns retrieval instead of reusing a quickstart-heavy platform slice", async () => {
  const docsRoot = await createSendMessageFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-first-message-followup");
  const sessionId = "first-message-followup-session";

  const first = await executeDocQuestion({
    runId: "first-message-clarify",
    question: "How to send my first message?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 6,
  });
  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "first-message-clarify",
    question: "How to send my first message?",
    hits: first.hits,
    summary: first.answer.summary,
    pendingQuestion: first.answer.pendingClarificationQuestion,
    clarificationHits: first.answer.clarificationHits,
    route: first.route,
    dataDir,
  });

  assert.equal(first.answer.summary, "platform clarification required");

  const second = await executeDocQuestion({
    runId: "first-message-followup-android",
    question: "Android",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 6,
  });

  assert.equal(Boolean(second.answer.followUpSource), true);
  assert.equal(second.answer.rewrittenQuestion, "How to send my first message on Android?");
  assert.equal(
    second.answer.citations.some((citation) =>
      citation.path.endsWith("docs/chatsdk-android/message/send.md"),
    ),
    true,
  );
  assert.equal(second.answer.answer.includes("Step 5"), false);
  assert.equal(second.answer.answer.includes("start a direct chat"), false);
});

void test("mixed community clarification keeps the definition and resumes only the procedural half", async () => {
  const docsRoot = await createCommunityChannelFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-mixed-community-followup");
  const sessionId = "mixed-community-session";

  const first = await executeDocQuestion({
    runId: "mixed-community-clarify",
    question: "What is community channel ?How to create a community channel?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });
  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "mixed-community-clarify",
    question: "What is community channel ?How to create a community channel?",
    hits: first.hits,
    summary: first.answer.summary,
    pendingQuestion: first.answer.pendingClarificationQuestion,
    clarificationHits: first.answer.clarificationHits,
    route: first.route,
    dataDir,
  });

  assert.equal(first.answer.summary, "platform clarification required");
  assert.equal(first.answer.answer.includes("Definition"), true);
  assert.equal(first.answer.answer.includes("Steps"), true);
  assert.equal(first.answer.answer.includes("Choose Android / iOS"), true);

  const second = await executeDocQuestion({
    runId: "mixed-community-android",
    question: "Android",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(second.answer.followUpSource, "clarification_rewrite");
  assert.equal(second.answer.continuedFromRunId, "mixed-community-clarify");
  assert.equal(second.answer.rewrittenQuestion, "How to create a community channel on Android?");
  assert.equal(second.answer.answer.includes("Definition"), false);
  assert.equal(second.answer.answer.includes("Android"), true);
  assert.equal(second.answer.answer.includes("Server API"), true);
});

void test("mixed community clarification also resumes from a Chinese Android follow-up", async () => {
  const docsRoot = await createCommunityChannelFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-mixed-community-followup-zh");
  const sessionId = "mixed-community-session-zh";

  const first = await executeDocQuestion({
    runId: "mixed-community-clarify-zh",
    question: "What is community channel ?How to create a community channel?",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });
  await updateClarificationStateAfterAnswer({
    sessionId,
    runId: "mixed-community-clarify-zh",
    question: "What is community channel ?How to create a community channel?",
    hits: first.hits,
    summary: first.answer.summary,
    pendingQuestion: first.answer.pendingClarificationQuestion,
    clarificationHits: first.answer.clarificationHits,
    route: first.route,
    dataDir,
  });

  const second = await executeDocQuestion({
    runId: "mixed-community-android-zh",
    question: "我要找android的",
    sessionId,
    mode: "extractive",
    docsRoot,
    dataDir,
    maxResults: 5,
  });

  assert.equal(Boolean(second.answer.followUpSource), true);
  assert.equal(second.answer.rewrittenQuestion, "How to create a community channel on Android?");
  assert.equal(second.answer.answer.includes("Server API"), true);
});

void test("docs.ask ignores contaminated clarification memory and continues to a platform guide", async (t) => {
  const docsRoot = await createClarificationReuseFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-followup-contaminated-memory");
  await replaceAnswerMemoryEntries(
    [
      makeMemoryEntry({
        question: "How to start a chat?",
        answer: "请告诉我你要看 Android、iOS 还是 Web。",
        summary: "platform clarification required",
        reviewStatus: "pending_review",
      }),
      makeMemoryEntry({
        question: "How to start a chat?",
        answer: "请告诉我你要看 Android、iOS 还是 Web。",
        summary: "platform clarification required",
        reviewStatus: "approved_standard",
      }),
    ],
    dataDir,
  );
  const { client } = await createHarness({ docsRoot, dataDir });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));
  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "How to start a chat?",
      idempotencyKey: "followup-contaminated-clarify",
      mode: "extractive",
    }),
  );
  const clarification = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "followup-contaminated-clarify";
    }),
  );
  assert.equal(clarification.summary, "platform clarification required");
  assert.equal(clarification.answerSource, "generated");

  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "Android",
      idempotencyKey: "followup-contaminated-answer",
      mode: "extractive",
    }),
  );
  const terminal = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "followup-contaminated-answer";
    }),
  );
  assert.equal(terminal.followUpSource, "clarification_reuse");
  assert.equal(terminal.answer.includes("请告诉我你要看 Android、iOS 还是 Web"), false);
  assert.equal(terminal.answer.includes("Steps"), true);
});

void test("short platform-only queries do not bind stale or missing clarification context", async (t) => {
  const docsRoot = await createClarificationRewriteFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-followup-stale");
  const { client } = await createHarness({ docsRoot, dataDir });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));

  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "安卓的",
      idempotencyKey: "followup-stale-missing",
      mode: "extractive",
    }),
  );
  const standalone = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "followup-stale-missing";
    }),
  );
  assert.equal(standalone.summary, "no relevant documentation found");
  assert.equal(standalone.followUpSource, undefined);

  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "How to chat?",
      idempotencyKey: "followup-stale-clarify",
      mode: "extractive",
    }),
  );
  await client.waitForEvent("docs.completed", (frame) => {
    const data = eventData<{ runId: string }>(frame);
    return data.runId === "followup-stale-clarify";
  });

  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "iOS",
      idempotencyKey: "followup-stale-resolve",
      mode: "extractive",
    }),
  );
  const resolved = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "followup-stale-resolve";
    }),
  );
  assert.equal(Boolean(resolved.followUpSource), true);

  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "Web",
      idempotencyKey: "followup-stale-after-resolved",
      mode: "extractive",
    }),
  );
  const stale = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "followup-stale-after-resolved";
    }),
  );
  assert.equal(stale.followUpSource, undefined);
  assert.equal(stale.continuedFromRunId, undefined);
  assert.equal(stale.rewrittenQuestion, undefined);
});

void test("invalid stored clarification context is ignored and replaced by the next valid clarification", async (t) => {
  const docsRoot = await createClarificationReuseFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-followup-invalid-context");
  await fs.writeFile(
    path.join(dataDir, "follow-up-context.json"),
    JSON.stringify(
      {
        "broken-session": {
          sessionId: "broken-session",
          runId: "broken-run",
          originalQuestion: "Android",
          candidatePlatforms: [],
          hits: [],
          createdAt: Date.now(),
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
  const { client } = await createHarness({ docsRoot, dataDir });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));
  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "Android",
      idempotencyKey: "followup-invalid-context-standalone",
      mode: "extractive",
    }),
  );
  const standalone = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "followup-invalid-context-standalone";
    }),
  );
  assert.equal(standalone.followUpSource, undefined);

  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "How to start a chat?",
      idempotencyKey: "followup-invalid-context-clarify",
      mode: "extractive",
    }),
  );
  await client.waitForEvent("docs.completed", (frame) => {
    const data = eventData<{ runId: string }>(frame);
    return data.runId === "followup-invalid-context-clarify";
  });
  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "Android",
      idempotencyKey: "followup-invalid-context-answer",
      mode: "extractive",
    }),
  );
  const terminal = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "followup-invalid-context-answer";
    }),
  );
  assert.equal(Boolean(terminal.followUpSource), true);
  assert.equal(terminal.answer.includes("Steps"), true);
});

void test("docs.ask in agent mode emits delta and returns selected model metadata", async (t) => {
  const docsRoot = await createLifecycleFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-agent");
  const { client } = await createHarness({
    docsRoot,
    dataDir,
    defaultAgentConfig: {
      model: "learning-primary",
      provider: "mock",
    },
  });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));

  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "Where does OpenClaw load workspace and personal skills from?",
      idempotencyKey: "agent-run-1",
      mode: "agent",
    }),
  );

  await client.waitForEvent(
    "docs.retrieval",
    (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "agent-run-1";
    },
    25_000,
  );
  await client.waitForEvent("docs.delta", (frame) => {
    const data = eventData<{ runId: string }>(frame);
    return data.runId === "agent-run-1";
  });
  const terminal = eventData<DocsTerminalResult>(
    await client.waitForEvent(
      "docs.completed",
      (frame) => {
        const data = eventData<{ runId: string }>(frame);
        return data.runId === "agent-run-1";
      },
      10_000,
    ),
  );
  assert.equal(terminal.status, "ok");
  assert.equal(terminal.mode, "agent");
  assert.equal(client.getEvents("docs.delta").length > 0, true);
  assert.equal(terminal.selectedModel, "learning-primary");
  assert.equal(terminal.selectedProvider, "mock");
  assert.equal(terminal.answerSurface?.trust, "non_authoritative");
  assert.equal(terminal.answer.includes("Steps") || terminal.answer.includes("Sources:"), true);
  assert.equal(terminal.answer.includes("FINAL_ANSWER_START"), false);
  assert.equal(terminal.answer.includes("Retrieved documentation:"), false);
  assert.equal(terminal.citations.length > 0, true);
});

void test("agent mode preserves clarification answers instead of letting the mock agent rewrite them", async () => {
  const docsRoot = await createSendMessageFixtureDocs();
  const hits = await searchDocs({
    query: "How to send a message?",
    docsRoot,
    maxResults: 6,
  });

  const extractive = await buildDocAnswer({
    runId: "send-agent-bypass-extractive",
    question: "How to send a message?",
    mode: "extractive",
    hits,
  });
  const agent = await buildDocAnswer({
    runId: "send-agent-bypass-agent",
    question: "How to send a message?",
    mode: "agent",
    hits,
    provider: "mock",
    model: "learning-primary",
  });

  assert.equal(agent.mode, "agent");
  assert.equal(agent.answer, extractive.answer);
  assert.equal(agent.summary, extractive.summary);
  assert.equal(agent.selectedModel, undefined);
  assert.equal(agent.selectedProvider, undefined);
});

void test("docs.run.wait returns the terminal result and docs.run.status exposes terminal state", async (t) => {
  const docsRoot = await createLifecycleFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-run-wait");
  const { client } = await createHarness({ docsRoot, dataDir });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));
  const accepted = responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "How do I check my Node version?",
      idempotencyKey: "wait-run-1",
      mode: "extractive",
    }),
  );

  const waited = responseResult<DocsTerminalResult>(
    await client.request("docs.run.wait", {
      runId: accepted.runId,
      timeoutMs: 10_000,
    }),
  );
  assert.equal(waited.status, "ok");
  assert.equal(waited.runId, "wait-run-1");
  assert.equal(waited.answer.toLowerCase().includes("node"), true);
  assert.equal(
    waited.citations.some((citation) => citation.path.endsWith("node.md")),
    true,
  );

  const status = responseResult<DocsTerminalResult>(
    await client.request("docs.run.status", { runId: accepted.runId }),
  );
  assert.equal(status.status, "ok");
  assert.equal(status.runId, accepted.runId);
});

void test("repeated docs.ask with the same idempotencyKey returns cached terminal result", async (t) => {
  const docsRoot = await createLifecycleFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-dedupe");
  const { client } = await createHarness({ docsRoot, dataDir });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));

  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "What Node version does OpenClaw require?",
      idempotencyKey: "dedupe-run-1",
    }),
  );

  const firstTerminal = responseResult<DocsTerminalResult>(
    await client.request("docs.run.wait", {
      runId: "dedupe-run-1",
      timeoutMs: 10_000,
    }),
  );
  assert.equal(firstTerminal.status, "ok");

  const cached = responseResult<DocsTerminalResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "What Node version does OpenClaw require?",
      idempotencyKey: "dedupe-run-1",
    }),
  );
  assert.equal(cached.status, "ok");
  assert.equal(cached.runId, "dedupe-run-1");
});

void test("no-hit queries return ok with empty citations", async (t) => {
  const docsRoot = await makeTempDir("doc-assistant-custom-docs");
  await fs.writeFile(
    path.join(docsRoot, "only.md"),
    "# Only doc\n\nThis file talks about apples and pears.\n",
    "utf-8",
  );
  const dataDir = await makeTempDir("doc-assistant-nohit");
  const { client } = await createHarness({ docsRoot, dataDir });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));

  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "How do I configure Kubernetes probes?",
      idempotencyKey: "no-hit-run-1",
    }),
  );

  const terminal = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "no-hit-run-1";
    }),
  );
  assert.equal(terminal.status, "ok");
  assert.deepEqual(terminal.citations, []);
  assert.equal(terminal.summary, "no relevant documentation found");

  const history = responseResult<{
    total: number;
    entries: Array<{
      question: string;
      answered: boolean;
      answerOutcome: string;
      citationCount: number;
    }>;
  }>(
    await client.request("docs.history.list", {
      userId: user.userId,
      answered: false,
    }),
  );
  assert.equal(history.total, 1);
  assert.equal(history.entries[0]?.answered, false);
  assert.equal(history.entries[0]?.answerOutcome, "no_relevant_docs");
  assert.equal(history.entries[0]?.citationCount, 0);
});

void test("agent mode can use openai-compatible backend", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                "可以使用 `NCCallPushConfig` 配置推送字段，并通过 `startCall:callType:mediaType:pushConfig:extra:` 传入。[docs/callsdk-ios/push-config.md:5-10]",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )) as typeof fetch;

  const result = await buildDocAnswer({
    runId: "remote-1",
    question: "How do I configure push settings?",
    mode: "agent",
    hits: [
      {
        path: "docs/callsdk-ios/push-config.md",
        heading: "Top-level object: `NCCallPushConfig`",
        startLine: 5,
        endLine: 10,
        snippet: "The current iOS Call SDK supports push settings in these scenarios.",
        text: "The current iOS Call SDK supports push settings in these scenarios.",
        score: 12,
      },
    ],
    openAICompatible: {
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
    },
    provider: "openai-compatible",
  });

  assert.equal(result.mode, "agent");
  assert.equal(result.selectedProvider, "openai-compatible");
  assert.equal(result.selectedModel, "gpt-test");
  assert.equal(result.answerSurface?.trust, "authoritative");
  assert.equal(result.answer.includes("Sources:"), true);
});

void test("agent mode rejects prompt scaffolding echoes from openai-compatible responses", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [
                "Question: How do I configure push settings?\n",
                "Retrieved documentation:\n",
                "Only use the retrieved documentation.\n",
                "Write a developer-helpful guide, not a search report.\n",
              ].join(""),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )) as typeof fetch;

  const result = await buildDocAnswer({
    runId: "remote-echo-1",
    question: "How do I configure push settings?",
    mode: "agent",
    hits: [
      {
        path: "docs/callsdk-ios/push-config.md",
        heading: "Top-level object: `NCCallPushConfig`",
        startLine: 5,
        endLine: 10,
        snippet: "Use NCCallPushConfig to configure push fields before starting a call.",
        text: "Use NCCallPushConfig to configure push fields before starting a call.",
        score: 12,
      },
    ],
    openAICompatible: {
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
    },
    provider: "openai-compatible",
  });

  assert.equal(result.answer.includes("Question:"), false);
  assert.equal(result.answer.includes("Retrieved documentation:"), false);
  assert.equal(result.answerSurface?.note, "rejected_prompt_scaffolding_output");
  assert.equal(result.selectedProvider, undefined);
  assert.equal(result.selectedModel, undefined);
});

void test("agent mode bypasses openai-compatible calls for clarification-shaped grounded answers", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () => {
    throw new Error("fetch should not be called for clarification answers");
  }) as typeof fetch;

  const docsRoot = await createSendMessageFixtureDocs();
  const hits = await searchDocs({
    query: "How to send a message?",
    docsRoot,
    maxResults: 6,
  });

  const result = await buildDocAnswer({
    runId: "send-agent-openai-bypass",
    question: "How to send a message?",
    mode: "agent",
    hits,
    provider: "openai-compatible",
    openAICompatible: {
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
    },
  });

  assert.equal(result.summary, "platform clarification required");
  assert.equal(result.answer.includes("Relevant doc entry points"), true);
  assert.equal(result.selectedProvider, undefined);
  assert.equal(result.selectedModel, undefined);
});

void test("approved memory answers are served before retrieval and beat pending drafts", async (t) => {
  const docsRoot = await createGreetingFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-memory-standard");
  await replaceAnswerMemoryEntries(
    [
      makeMemoryEntry({
        question: "How to start a direct chat on Android?",
        questionVariants: ["How do I start a direct chat on Android?"],
        answer: "标准答案：先初始化 Android Chat SDK，再创建 DirectChannel 并发送第一条消息。",
        summary: "approved standard direct chat answer",
        reviewStatus: "approved_standard",
      }),
      makeMemoryEntry({
        question: "How to start a direct chat on Android?",
        answer: "草稿答案：这是待审核版本。",
        summary: "pending draft direct chat answer",
        reviewStatus: "pending_review",
      }),
    ],
    dataDir,
  );
  const { client } = await createHarness({ docsRoot, dataDir });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));
  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "How do I start a direct chat on Android?",
      idempotencyKey: "memory-standard-run-1",
    }),
  );

  const terminal = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "memory-standard-run-1";
    }),
  );
  assert.equal(terminal.answerSource, "memory_standard");
  assert.equal(terminal.reviewStatus, "approved_standard");
  assert.equal(terminal.answer.includes("标准答案"), true);
  assert.equal(client.getEvents("docs.retrieval").length, 0);

  const history = responseResult<{
    entries: Array<{ answerOutcome: string; answerSource?: string; reviewStatus?: string }>;
  }>(await client.request("docs.history.list", { userId: user.userId }));
  assert.equal(history.entries[0]?.answerOutcome, "memory_standard");
  assert.equal(history.entries[0]?.answerSource, "memory_standard");
  assert.equal(history.entries[0]?.reviewStatus, "approved_standard");
});

void test("pending memory drafts stay review-only and do not answer user questions directly", async (t) => {
  const docsRoot = await createPushFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-memory-draft");
  await replaceAnswerMemoryEntries(
    [
      makeMemoryEntry({
        question: "How do I configure push settings for the iOS Call SDK?",
        questionVariants: ["How can I configure iOS Call SDK push settings?"],
        answer: "草稿：先准备 NCCallPushConfig，再把 pushTitle 和 pushContent 传入 startCall。",
        summary: "pending review push answer",
        reviewStatus: "pending_review",
      }),
    ],
    dataDir,
  );
  const { client } = await createHarness({ docsRoot, dataDir });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));
  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "How can I configure push settings for iOS Call SDK?",
      idempotencyKey: "memory-draft-run-1",
    }),
  );
  const terminal = eventData<DocsTerminalResult>(
    await client.waitForEvent("docs.completed", (frame) => {
      const data = eventData<{ runId: string }>(frame);
      return data.runId === "memory-draft-run-1";
    }),
  );
  assert.notEqual(terminal.answerSource, "memory_draft");
  assert.equal(
    terminal.citations.some((citation) => citation.path.endsWith("push-config.md")),
    true,
  );
  assert.equal(client.getEvents("docs.retrieval").length > 0, true);
});

void test("generated answers are enqueued into memory and can be approved through admin RPC", async (t) => {
  const docsRoot = await createLifecycleFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-memory-generate");
  const adminToken = "secret-admin-token";
  const { client } = await createHarness({
    docsRoot,
    dataDir,
    adminToken,
    wsToken: adminToken,
  });
  t.after(() => client.close());

  const user = responseResult<UserCreateResult>(await client.request("docs.user.create"));
  responseResult<DocsAcceptedResult>(
    await client.request("docs.ask", {
      userId: user.userId,
      question: "How do I check my Node version?",
      idempotencyKey: "memory-generate-run-1",
      mode: "extractive",
    }),
  );
  const terminal = eventData<DocsTerminalResult>(
    await client.waitForEvent(
      "docs.completed",
      (frame) => {
        const data = eventData<{ runId: string }>(frame);
        return data.runId === "memory-generate-run-1";
      },
      25_000,
    ),
  );
  assert.equal(terminal.answerSource, "generated");
  assert.equal(terminal.reviewStatus, "pending_review");
  assert.equal(typeof terminal.memoryEntryId, "string");

  const pendingList = responseResult<{
    total: number;
    entries: Array<{ entryId: string; reviewStatus: string }>;
  }>(
    await client.request("docs.admin.memory.list", {
      status: "pending_review",
    }),
  );
  assert.equal(pendingList.total, 1);
  assert.equal(pendingList.entries[0]?.entryId, terminal.memoryEntryId);

  const approved = responseResult<{ reviewStatus: string; answer: string }>(
    await client.request("docs.admin.memory.approve", {
      entryId: terminal.memoryEntryId,
      editedAnswer: "管理员标准答案：OpenClaw 要求 Node.js 24 以上，先运行 `node -v` 检查版本。",
    }),
  );
  assert.equal(approved.reviewStatus, "approved_standard");
  assert.equal(approved.answer.includes("管理员标准答案"), true);

  const status = responseResult<StatusResult>(await client.request("docs.status"));
  assert.equal(status.memoryEntries, 1);
  assert.equal(status.pendingReviewEntries, 0);
  assert.equal(status.approvedStandardEntries, 1);
});
