import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { replaceAnswerMemoryEntries } from "./answer-memory.js";
import { createDocAssistantRuntimeState } from "./server-runtime-state.js";
import { createDocAssistantRouter } from "./server-methods.js";
import { handleConnection } from "./ws-connection.js";
import { serveDocAssistantApi } from "./http-api.js";
import { serveDocAssistantUi } from "./http-ui.js";
import { createDocAssistantServer } from "./server.js";
import type { AnswerMemoryEntry } from "./protocol/index.js";

async function makeTempDir(name: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function createFixtureDocs(): Promise<string> {
  const rootDir = await makeTempDir("doc-assistant-http-docs");
  const docsRoot = path.join(rootDir, "docs");
  await fs.mkdir(path.join(docsRoot, "callsdk-ios"), { recursive: true });
  await fs.writeFile(
    path.join(docsRoot, "callsdk-ios", "push-config.md"),
    [
      "# Top-level object: `NCCallPushConfig`",
      "",
      "Use NCCallPushConfig to define pushTitle and pushContent.",
      "",
      "# iOS-specific object: `NCCallIOSPushConfig`",
      "",
      "Use NCCallIOSPushConfig to define threadId and apnsCollapseId.",
    ].join("\n"),
    "utf-8",
  );
  return docsRoot;
}

function makeHttpMemoryEntry(params: {
  question: string;
  answer: string;
  reviewStatus: "pending_review" | "approved_standard" | "rejected";
}): AnswerMemoryEntry {
  const now = Date.now();
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  return {
    entryId: randomUUID(),
    question: params.question,
    normalizedQuestion: normalize(params.question),
    questionVariants: [params.question],
    normalizedQuestionVariants: [normalize(params.question)],
    answer: params.answer,
    summary: "memory answer",
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

class EventCollector {
  private events: Array<{ event: string; data: unknown }> = [];
  private waiters: Array<{
    event: string;
    resolve: (frame: { event: string; data: unknown }) => void;
    predicate?: (frame: { event: string; data: unknown }) => boolean;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(private readonly ws: MockWebSocket) {
    const processFrame = (raw: string) => {
      const frame = JSON.parse(raw) as { event?: string; data?: unknown; id?: string };
      if (!frame.event) {
        return;
      }
      const normalized = {
        event: frame.event,
        data: frame.data,
      };
      this.events.push(normalized);
      const waiter = this.waiters.find(
        (entry) =>
          entry.event === normalized.event &&
          (entry.predicate ? entry.predicate(normalized) : true),
      );
      if (!waiter) {
        return;
      }
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter((entry) => entry !== waiter);
      waiter.resolve(normalized);
    };

    for (const frame of ws.sentFrames) {
      processFrame(frame);
    }
    ws.onSend(processFrame);
  }

  async waitFor(
    event: string,
    predicate?: (frame: { event: string; data: unknown }) => boolean,
    timeoutMs = 5_000,
  ): Promise<{ event: string; data: unknown }> {
    const existing = this.events.find(
      (frame) => frame.event === event && (predicate ? predicate(frame) : true),
    );
    if (existing) {
      return existing;
    }
    return await new Promise<{ event: string; data: unknown }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((entry) => entry.resolve !== resolve);
        reject(new Error(`Timed out waiting for event ${event}`));
      }, timeoutMs);
      this.waiters.push({ event, resolve, predicate, timer });
    });
  }

  getEvents(event: string): Array<{ event: string; data: unknown }> {
    return this.events.filter((frame) => frame.event === event);
  }
}

type MockRequestOptions = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
};

class MockIncomingMessage implements AsyncIterable<Buffer> {
  method: string;
  url: string;
  headers: Record<string, string>;
  private readonly body?: string;

  constructor(options: MockRequestOptions) {
    this.method = options.method;
    this.url = options.url;
    this.headers = options.headers ?? {};
    this.body = options.body === undefined ? undefined : JSON.stringify(options.body);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Buffer> {
    if (this.body === undefined) {
      return;
    }
    yield Buffer.from(this.body, "utf-8");
  }
}

class MockServerResponse {
  statusCode = 200;
  headers = new Map<string, string>();
  body = "";

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  writeHead(status: number, headers?: Record<string, string>): this {
    this.statusCode = status;
    for (const [key, value] of Object.entries(headers ?? {})) {
      this.setHeader(key, value);
    }
    return this;
  }

  end(data?: string | Buffer): void {
    if (typeof data === "string") {
      this.body += data;
      return;
    }
    if (Buffer.isBuffer(data)) {
      this.body += data.toString("utf-8");
    }
  }

  json(): unknown {
    return JSON.parse(this.body) as unknown;
  }
}

async function createHttpHarness(params?: { adminToken?: string }) {
  const docsRoot = await createFixtureDocs();
  const dataDir = await makeTempDir("doc-assistant-http-data");
  const state = createDocAssistantRuntimeState({
    docsRoot,
    dataDir,
    defaultMode: "extractive",
    adminToken: params?.adminToken,
  });
  const router = createDocAssistantRouter();
  const ws = new MockWebSocket();
  handleConnection(ws as Parameters<typeof handleConnection>[0], { clientId: "http-test-client" }, state, router);
  const events = new EventCollector(ws);
  await events.waitFor("docs.connected");
  return { docsRoot, state, router, ws, events };
}

async function dispatchApi(params: {
  state: ReturnType<typeof createDocAssistantRuntimeState>;
  router: ReturnType<typeof createDocAssistantRouter>;
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  allowedOrigins?: string[];
}) {
  const req = new MockIncomingMessage({
    method: params.method,
    url: `/api/doc-assistant${params.path}`,
    headers: params.headers,
    body: params.body,
  });
  const res = new MockServerResponse();
  const handled = await serveDocAssistantApi({
    req: req as unknown as Parameters<typeof serveDocAssistantApi>[0]["req"],
    res: res as unknown as Parameters<typeof serveDocAssistantApi>[0]["res"],
    router: params.router,
    state: params.state,
    allowedOrigins: params.allowedOrigins,
  });
  return { handled, res };
}

test("HTTP API exposes users, search, runs, transcript, and status", async () => {
  const harness = await createHttpHarness();

  const user = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "POST",
    path: "/users",
    body: { displayLabel: "http-user" },
    headers: {
      origin: "https://docs.example.com",
      "content-type": "application/json",
    },
    allowedOrigins: ["https://docs.example.com"],
  });
  assert.equal(user.handled, true);
  assert.equal(user.res.statusCode, 200);
  assert.equal(user.res.headers.get("access-control-allow-origin"), "https://docs.example.com");
  const userPayload = user.res.json() as {
    ok: boolean;
    result: { userId: string; sessionKey: string };
  };
  assert.equal(userPayload.ok, true);
  assert.equal(userPayload.result.sessionKey, `temp/${userPayload.result.userId}`);

  const preview = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "POST",
    path: "/search/preview",
    body: {
      query: "How do I configure push settings for the iOS Call SDK?",
      maxResults: 3,
    },
    headers: {
      "content-type": "application/json",
    },
  });
  const previewPayload = preview.res.json() as {
    ok: boolean;
    result: { hits: Array<{ path: string }> };
  };
  assert.equal(previewPayload.ok, true);
  assert.equal(
    previewPayload.result.hits.some((hit) => hit.path === "docs/callsdk-ios/push-config.md"),
    true,
  );

  const accepted = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "POST",
    path: "/runs",
    body: {
      userId: userPayload.result.userId,
      question: "How do I configure push settings for the iOS Call SDK?",
      idempotencyKey: "http-run-1",
      mode: "extractive",
      maxResults: 2,
    },
    headers: {
      "content-type": "application/json",
      "x-doc-assistant-client-id": "http-test-client",
    },
  });
  const acceptedPayload = accepted.res.json() as {
    ok: boolean;
    result: { runId: string; status: string };
  };
  assert.equal(acceptedPayload.ok, true);
  assert.equal(acceptedPayload.result.runId, "http-run-1");

  const retrievalEvent = await harness.events.waitFor("docs.retrieval", (frame) => {
    const data = frame.data as { runId: string };
    return data.runId === "http-run-1";
  });
  const retrievalData = retrievalEvent.data as { hits: Array<{ path: string }> };
  assert.equal(retrievalData.hits[0]?.path, "docs/callsdk-ios/push-config.md");

  const waited = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "GET",
    path: "/runs/http-run-1/wait?timeoutMs=10000",
  });
  const waitPayload = waited.res.json() as {
    ok: boolean;
    result: { runId: string; status: string; answer: string };
  };
  assert.equal(waitPayload.ok, true);
  assert.equal(waitPayload.result.runId, "http-run-1");
  assert.equal(waitPayload.result.status, "ok");
  assert.equal(waitPayload.result.answer.includes("Sources:"), true);

  const completedEvent = await harness.events.waitFor("docs.completed", (frame) => {
    const data = frame.data as { runId: string };
    return data.runId === "http-run-1";
  });
  const completedData = completedEvent.data as { citations: Array<{ path: string }> };
  assert.equal(completedData.citations[0]?.path, "docs/callsdk-ios/push-config.md");

  const status = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "GET",
    path: "/runs/http-run-1",
  });
  const statusPayload = status.res.json() as {
    ok: boolean;
    result: { runId: string; status: string };
  };
  assert.equal(statusPayload.ok, true);
  assert.equal(statusPayload.result.status, "ok");

  const transcript = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "GET",
    path: `/transcripts/${userPayload.result.userId}`,
  });
  const transcriptPayload = transcript.res.json() as {
    ok: boolean;
    result: { messages: Array<{ role: string }> };
  };
  assert.equal(transcriptPayload.ok, true);
  assert.equal(transcriptPayload.result.messages[0]?.role, "user");
  assert.equal(transcriptPayload.result.messages.at(-1)?.role, "assistant");

  const history = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "GET",
    path: `/history?userId=${encodeURIComponent(userPayload.result.userId)}`,
  });
  const historyPayload = history.res.json() as {
    ok: boolean;
    result: {
      total: number;
      entries: Array<{
        userId: string;
        question: string;
        answered: boolean;
        answerOutcome: string;
      }>;
    };
  };
  assert.equal(historyPayload.ok, true);
  assert.equal(historyPayload.result.total, 1);
  assert.equal(historyPayload.result.entries[0]?.userId, userPayload.result.userId);
  assert.equal(historyPayload.result.entries[0]?.answered, true);
  assert.equal(historyPayload.result.entries[0]?.answerOutcome, "answered");

  const methods = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "GET",
    path: "/methods",
  });
  const methodsPayload = methods.res.json() as {
    ok: boolean;
    result: { methods: Array<{ method: string }> };
  };
  assert.equal(methodsPayload.ok, true);
  assert.equal(methodsPayload.result.methods.some((entry) => entry.method === "docs.ask"), true);
  assert.equal(methodsPayload.result.methods.some((entry) => entry.method === "docs.history.list"), true);

  const runtimeStatus = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "GET",
    path: "/status",
  });
  const runtimeStatusPayload = runtimeStatus.res.json() as {
    ok: boolean;
    result: {
      status: string;
      version: string;
      packageVersion: string;
      docsRoot: string;
      questionHistoryEntries: number;
    };
  };
  assert.equal(runtimeStatusPayload.ok, true);
  assert.equal(runtimeStatusPayload.result.status, "running");
  assert.equal(runtimeStatusPayload.result.version, "v0.1");
  assert.equal(runtimeStatusPayload.result.packageVersion, "0.1.0");
  assert.equal(runtimeStatusPayload.result.docsRoot, harness.docsRoot);
  assert.equal(runtimeStatusPayload.result.questionHistoryEntries, 1);
});

test("HTTP API handles CORS preflight and serves the built-in UI page", async () => {
  const harness = await createHttpHarness();

  const localhostPreflight = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "OPTIONS",
    path: "/runs",
    headers: {
      origin: "http://localhost:3000",
      "access-control-request-method": "POST",
      "access-control-request-headers": "Content-Type,X-Doc-Assistant-Client-Id",
    },
  });
  assert.equal(localhostPreflight.res.statusCode, 204);
  assert.equal(localhostPreflight.res.headers.get("access-control-allow-origin"), "http://localhost:3000");

  const preflight = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "OPTIONS",
    path: "/runs",
    headers: {
      origin: "https://docs.example.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "Content-Type,X-Doc-Assistant-Client-Id",
    },
    allowedOrigins: ["https://docs.example.com"],
  });
  assert.equal(preflight.res.statusCode, 204);
  assert.equal(preflight.res.headers.get("access-control-allow-origin"), "https://docs.example.com");
  assert.equal(preflight.res.headers.get("access-control-allow-methods"), "GET,POST,OPTIONS");

  const uiReq = new MockIncomingMessage({
    method: "GET",
    url: "/ui",
  });
  const uiRes = new MockServerResponse();
  const uiHandled = await serveDocAssistantUi(
    uiReq as unknown as Parameters<typeof serveDocAssistantUi>[0],
    uiRes as unknown as Parameters<typeof serveDocAssistantUi>[1],
  );
  assert.equal(uiHandled, true);
  assert.equal(uiRes.statusCode, 200);
  assert.equal(uiRes.body.includes("Learn Doc Assistant"), true);

  const assetReq = new MockIncomingMessage({
    method: "GET",
    url: "/assets/doc-assistant-ui.js",
  });
  const assetRes = new MockServerResponse();
  const assetHandled = await serveDocAssistantUi(
    assetReq as unknown as Parameters<typeof serveDocAssistantUi>[0],
    assetRes as unknown as Parameters<typeof serveDocAssistantUi>[1],
  );
  assert.equal(assetHandled, true);
  assert.equal(assetRes.body.includes("docs.ask"), true);
});

test("server bootstrap honors .env docs root outside src/index.ts", { concurrency: false }, async (t) => {
  const docsRoot = await createFixtureDocs();
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
  let originalEnvFile: string | null = null;
  try {
    originalEnvFile = await fs.readFile(envPath, "utf-8");
  } catch {
    originalEnvFile = null;
  }
  const originalEnvVar = process.env.DOC_ASSISTANT_DOCS_ROOT;
  t.after(async () => {
    if (originalEnvFile === null) {
      await fs.rm(envPath, { force: true });
    } else {
      await fs.writeFile(envPath, originalEnvFile, "utf-8");
    }
    if (originalEnvVar === undefined) {
      delete process.env.DOC_ASSISTANT_DOCS_ROOT;
    } else {
      process.env.DOC_ASSISTANT_DOCS_ROOT = originalEnvVar;
    }
  });

  delete process.env.DOC_ASSISTANT_DOCS_ROOT;
  await fs.writeFile(envPath, `DOC_ASSISTANT_DOCS_ROOT=${docsRoot}\n`, "utf-8");

  const server = await createDocAssistantServer({
    host: "127.0.0.1",
    port: 0,
    listen: false,
  });
  t.after(async () => {
    await server.close();
  });

  assert.equal(server.docsRoot, docsRoot);
  assert.equal(server.state.config.docsRoot, docsRoot);
  assert.equal(server.apiBaseUrl.endsWith("/api/doc-assistant"), true);
});

test("HTTP API greeting runs skip retrieval and complete with a guided greeting", async () => {
  const harness = await createHttpHarness();

  const user = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "POST",
    path: "/users",
    body: { displayLabel: "http-greeting-user" },
    headers: {
      "content-type": "application/json",
    },
  });
  const userPayload = user.res.json() as {
    ok: boolean;
    result: { userId: string };
  };
  assert.equal(userPayload.ok, true);

  const accepted = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "POST",
    path: "/runs",
    body: {
      userId: userPayload.result.userId,
      question: "Hello",
      idempotencyKey: "http-greeting-run-1",
      mode: "extractive",
    },
    headers: {
      "content-type": "application/json",
      "x-doc-assistant-client-id": "http-test-client",
    },
  });
  const acceptedPayload = accepted.res.json() as {
    ok: boolean;
    result: { runId: string; status: string };
  };
  assert.equal(acceptedPayload.ok, true);
  assert.equal(acceptedPayload.result.runId, "http-greeting-run-1");
  assert.equal(acceptedPayload.result.status, "accepted");

  const waited = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "GET",
    path: "/runs/http-greeting-run-1/wait?timeoutMs=10000",
  });
  const waitPayload = waited.res.json() as {
    ok: boolean;
    result: {
      runId: string;
      status: string;
      summary: string;
      answer: string;
      citations: unknown[];
    };
  };
  assert.equal(waitPayload.ok, true);
  assert.equal(waitPayload.result.runId, "http-greeting-run-1");
  assert.equal(waitPayload.result.status, "ok");
  assert.equal(waitPayload.result.summary, "guided greeting");
  assert.equal(waitPayload.result.answer.includes("I'm your Nexconn documentation assistant"), true);
  assert.equal(waitPayload.result.answer.includes("For example:"), true);
  assert.deepEqual(waitPayload.result.citations, []);

  const completedEvent = await harness.events.waitFor("docs.completed", (frame) => {
    const data = frame.data as { runId: string };
    return data.runId === "http-greeting-run-1";
  });
  const completedData = completedEvent.data as { summary: string; citations: unknown[] };
  assert.equal(completedData.summary, "guided greeting");
  assert.deepEqual(completedData.citations, []);
  assert.equal(
    harness.events
      .getEvents("docs.retrieval")
      .filter((frame) => (frame.data as { runId?: string }).runId === "http-greeting-run-1").length,
    0,
  );
});

test("HTTP admin memory endpoints require auth and can approve standard answers", async () => {
  const adminToken = "http-admin-token";
  const harness = await createHttpHarness({ adminToken });
  await replaceAnswerMemoryEntries(
    [
      makeHttpMemoryEntry({
        question: "How do I configure push settings for the iOS Call SDK?",
        answer: "待审核草稿答案",
        reviewStatus: "pending_review",
      }),
    ],
    harness.state.config.dataDir,
  );

  const unauthorized = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "GET",
    path: "/admin/memory",
  });
  const unauthorizedPayload = unauthorized.res.json() as {
    ok: boolean;
    error: { code: string };
  };
  assert.equal(unauthorized.res.statusCode, 401);
  assert.equal(unauthorizedPayload.ok, false);
  assert.equal(unauthorizedPayload.error.code, "UNAUTHORIZED");

  const authorizedList = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "GET",
    path: "/admin/memory?status=pending_review",
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  const listPayload = authorizedList.res.json() as {
    ok: boolean;
    result: {
      total: number;
      entries: Array<{ entryId: string; reviewStatus: string }>;
    };
  };
  assert.equal(listPayload.ok, true);
  assert.equal(listPayload.result.total, 1);
  const entryId = listPayload.result.entries[0]?.entryId;
  assert.equal(typeof entryId, "string");

  const approved = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "POST",
    path: `/admin/memory/${encodeURIComponent(String(entryId))}/approve`,
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: {
      editedAnswer: "标准答案：使用 NCCallPushConfig 配置推送字段。",
    },
  });
  const approvedPayload = approved.res.json() as {
    ok: boolean;
    result: { reviewStatus: string; answer: string };
  };
  assert.equal(approvedPayload.ok, true);
  assert.equal(approvedPayload.result.reviewStatus, "approved_standard");
  assert.equal(approvedPayload.result.answer.includes("标准答案"), true);

  const getApproved = await dispatchApi({
    state: harness.state,
    router: harness.router,
    method: "GET",
    path: `/admin/memory/${encodeURIComponent(String(entryId))}`,
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });
  const getPayload = getApproved.res.json() as {
    ok: boolean;
    result: { reviewStatus: string };
  };
  assert.equal(getPayload.ok, true);
  assert.equal(getPayload.result.reviewStatus, "approved_standard");
});
