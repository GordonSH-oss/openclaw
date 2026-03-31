import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  makeError,
  type ConnectedClient,
  type DocAssistantError,
  type DocAssistantRequest,
  type DocAssistantResponse,
} from "./protocol/index.js";
import { resolveScopesFromToken } from "./auth.js";
import type { MethodRouter } from "./method-router.js";
import type { DocAssistantRuntimeState } from "./server-runtime-state.js";

const API_BASE_PATH = "/api/doc-assistant";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value ?? undefined;
}

function buildHttpClient(req: IncomingMessage, state: DocAssistantRuntimeState): ConnectedClient {
  const authorization = readHeader(req, "authorization");
  const token = authorization?.replace(/^bearer\s+/i, "").trim();
  const clientId = readHeader(req, "x-doc-assistant-client-id")?.trim();
  const authenticated = Boolean(token);
  return {
    connId: `http:${randomUUID()}`,
    authenticated,
    scopes: resolveScopesFromToken(token, state.config.adminToken),
    connect: {
      token: token || undefined,
      clientId: clientId || undefined,
    },
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw makeError("INVALID_REQUEST", "请求体必须是合法 JSON");
  }
}

function mapErrorStatus(error?: DocAssistantError): number {
  switch (error?.code) {
    case "INVALID_REQUEST":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "TIMEOUT":
      return 408;
    case "UNAVAILABLE":
      return 503;
    default:
      return 500;
  }
}

function writeCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: string[] | undefined,
): void {
  const origin = readHeader(req, "origin");
  if (!origin || !allowedOrigins || allowedOrigins.length === 0) {
    return;
  }
  const allowAny = allowedOrigins.includes("*");
  if (!allowAny && !allowedOrigins.includes(origin)) {
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", allowAny ? "*" : origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Doc-Assistant-Client-Id");
  res.setHeader("Vary", "Origin");
}

function writeJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
  allowedOrigins?: string[],
): void {
  writeCorsHeaders(req, res, allowedOrigins);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function dispatchRouter(params: {
  router: MethodRouter;
  state: DocAssistantRuntimeState;
  client: ConnectedClient;
  method: string;
  requestParams?: unknown;
}): Promise<DocAssistantResponse> {
  const request: DocAssistantRequest = {
    id: randomUUID(),
    method: params.method,
    params: params.requestParams,
  };
  return await new Promise<DocAssistantResponse>((resolve) => {
    const respond = (ok: boolean, result?: unknown, error?: DocAssistantError) => {
      resolve({
        id: request.id,
        ok,
        result,
        error,
      });
    };
    void params.router.dispatch({
      request,
      respond,
      client: params.client,
      state: params.state,
    });
  });
}

async function handleApiRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  router: MethodRouter;
  state: DocAssistantRuntimeState;
  allowedOrigins?: string[];
}): Promise<boolean> {
  const url = new URL(params.req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith(API_BASE_PATH)) {
    return false;
  }

  if (params.req.method === "OPTIONS") {
    writeCorsHeaders(params.req, params.res, params.allowedOrigins);
    params.res.writeHead(204);
    params.res.end();
    return true;
  }

  const client = buildHttpClient(params.req, params.state);
  const subPath = url.pathname.slice(API_BASE_PATH.length) || "/";
  let body: unknown;

  if (params.req.method === "POST") {
    try {
      body = await readJsonBody(params.req);
    } catch (error) {
      const docError = isRecord(error) && typeof error.code === "string" && typeof error.message === "string"
        ? (error as DocAssistantError)
        : makeError("INVALID_REQUEST", String(error));
      writeJson(params.req, params.res, mapErrorStatus(docError), { ok: false, error: docError }, params.allowedOrigins);
      return true;
    }
  }

  let response: DocAssistantResponse | undefined;
  if (params.req.method === "POST" && subPath === "/users") {
    response = await dispatchRouter({
      router: params.router,
      state: params.state,
      client,
      method: "docs.user.create",
      requestParams: body,
    });
  } else if (params.req.method === "POST" && subPath === "/search/preview") {
    response = await dispatchRouter({
      router: params.router,
      state: params.state,
      client,
      method: "docs.search.preview",
      requestParams: body,
    });
  } else if (params.req.method === "POST" && subPath === "/runs") {
    response = await dispatchRouter({
      router: params.router,
      state: params.state,
      client,
      method: "docs.ask",
      requestParams: body,
    });
  } else if (params.req.method === "GET" && subPath === "/status") {
    response = await dispatchRouter({
      router: params.router,
      state: params.state,
      client,
      method: "docs.status",
    });
  } else if (params.req.method === "GET" && subPath === "/methods") {
    response = await dispatchRouter({
      router: params.router,
      state: params.state,
      client,
      method: "docs.methods",
    });
  } else if (params.req.method === "GET" && subPath === "/history") {
    const userId = url.searchParams.get("userId") ?? undefined;
    const answeredRaw = url.searchParams.get("answered");
    const answered =
      answeredRaw === null ? undefined : answeredRaw.toLowerCase() === "true" ? true : answeredRaw.toLowerCase() === "false" ? false : answeredRaw;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    response = await dispatchRouter({
      router: params.router,
      state: params.state,
      client,
      method: "docs.history.list",
      requestParams: {
        ...(userId ? { userId } : {}),
        ...(typeof answered === "boolean" ? { answered } : answeredRaw !== null ? { answered } : {}),
        ...(limit ? { limit } : {}),
      },
    });
  } else if (params.req.method === "GET" && subPath === "/admin/memory") {
    const status = url.searchParams.get("status") ?? undefined;
    const query = url.searchParams.get("query") ?? undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    response = await dispatchRouter({
      router: params.router,
      state: params.state,
      client,
      method: "docs.admin.memory.list",
      requestParams: {
        ...(status ? { status } : {}),
        ...(query ? { query } : {}),
        ...(limit ? { limit } : {}),
      },
    });
  } else if (params.req.method === "GET" && subPath.startsWith("/admin/memory/")) {
    const entryId = decodeURIComponent(subPath.slice("/admin/memory/".length));
    response = await dispatchRouter({
      router: params.router,
      state: params.state,
      client,
      method: "docs.admin.memory.get",
      requestParams: { entryId },
    });
  } else if (params.req.method === "GET" && subPath.startsWith("/runs/") && subPath.endsWith("/wait")) {
    const runId = decodeURIComponent(subPath.slice("/runs/".length, -"/wait".length));
    const timeoutRaw = url.searchParams.get("timeoutMs");
    const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined;
    response = await dispatchRouter({
      router: params.router,
      state: params.state,
      client,
      method: "docs.run.wait",
      requestParams: {
        runId,
        ...(timeoutMs ? { timeoutMs } : {}),
      },
    });
  } else if (params.req.method === "GET" && subPath.startsWith("/runs/")) {
    const runId = decodeURIComponent(subPath.slice("/runs/".length));
    response = await dispatchRouter({
      router: params.router,
      state: params.state,
      client,
      method: "docs.run.status",
      requestParams: { runId },
    });
  } else if (params.req.method === "GET" && subPath.startsWith("/transcripts/")) {
    const userId = decodeURIComponent(subPath.slice("/transcripts/".length));
    response = await dispatchRouter({
      router: params.router,
      state: params.state,
      client,
      method: "docs.session.transcript.get",
      requestParams: { userId },
    });
  } else if (params.req.method === "POST" && subPath.startsWith("/admin/memory/") && subPath.endsWith("/approve")) {
    const entryId = decodeURIComponent(
      subPath.slice("/admin/memory/".length, -"/approve".length),
    );
    response = await dispatchRouter({
      router: params.router,
      state: params.state,
      client,
      method: "docs.admin.memory.approve",
      requestParams: isRecord(body) ? { ...body, entryId } : { entryId },
    });
  } else if (params.req.method === "POST" && subPath.startsWith("/admin/memory/") && subPath.endsWith("/reject")) {
    const entryId = decodeURIComponent(
      subPath.slice("/admin/memory/".length, -"/reject".length),
    );
    response = await dispatchRouter({
      router: params.router,
      state: params.state,
      client,
      method: "docs.admin.memory.reject",
      requestParams: isRecord(body) ? { ...body, entryId } : { entryId },
    });
  } else if (params.req.method === "POST" && subPath.startsWith("/admin/memory/") && subPath.endsWith("/update")) {
    const entryId = decodeURIComponent(
      subPath.slice("/admin/memory/".length, -"/update".length),
    );
    response = await dispatchRouter({
      router: params.router,
      state: params.state,
      client,
      method: "docs.admin.memory.update",
      requestParams: isRecord(body) ? { ...body, entryId } : { entryId },
    });
  } else {
    writeJson(
      params.req,
      params.res,
      404,
      { ok: false, error: makeError("NOT_FOUND", `未知 HTTP API: ${params.req.method} ${subPath}`) },
      params.allowedOrigins,
    );
    return true;
  }

  if (response.ok) {
    writeJson(params.req, params.res, 200, { ok: true, result: response.result }, params.allowedOrigins);
    return true;
  }

  writeJson(
    params.req,
    params.res,
    mapErrorStatus(response.error),
    { ok: false, error: response.error },
    params.allowedOrigins,
  );
  return true;
}

export async function serveDocAssistantApi(params: {
  req: IncomingMessage;
  res: ServerResponse;
  router: MethodRouter;
  state: DocAssistantRuntimeState;
  allowedOrigins?: string[];
}): Promise<boolean> {
  return await handleApiRequest(params);
}
