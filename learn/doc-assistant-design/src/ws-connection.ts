import { randomUUID } from "node:crypto";
import { resolveScopesFromToken } from "./auth.js";
import type { MethodRouter } from "./method-router.js";
import {
  parseClientMessage,
  serializeMessage,
  makeError,
  type ConnectedClient,
  type ConnectParams,
  type DocAssistantResponse,
} from "./protocol.js";
import type { DocAssistantRuntimeState } from "./runtime-state.js";

type MessagePayload = {
  toString(): string;
};

type WebSocketLike = {
  OPEN: number;
  readyState: number;
  send(data: string): void;
  on(event: "message", listener: (data: MessagePayload) => void): void;
  on(event: "close", listener: (code: number, reason: Buffer) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};

function resolveClientFromQuery(
  query: Record<string, string | string[] | undefined>,
  adminToken: string | undefined,
): ConnectedClient {
  const tokenRaw = query.token;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  const clientIdRaw = query.clientId;
  const clientId = Array.isArray(clientIdRaw) ? clientIdRaw[0] : clientIdRaw;
  const authenticated = Boolean(token?.trim());
  const connectParams: ConnectParams = {
    token: token ?? undefined,
    clientId: clientId ?? undefined,
  };
  return {
    connId: randomUUID(),
    authenticated,
    scopes: resolveScopesFromToken(token, adminToken),
    connect: connectParams,
  };
}

export function handleConnection(
  ws: WebSocketLike,
  query: Record<string, string | string[] | undefined>,
  state: DocAssistantRuntimeState,
  router: MethodRouter,
): void {
  const client = resolveClientFromQuery(query, state.config.adminToken);
  const connId = client.connId;

  const send = (msg: string) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(msg);
    }
  };

  state.broadcaster.registerConn(connId, send);
  if (client.connect.clientId) {
    state.broadcaster.registerClientId(connId, client.connect.clientId);
  }

  send(
    serializeMessage({
      event: "docs.connected",
      data: {
        connId,
        authenticated: client.authenticated,
        scopes: client.scopes,
        serverTime: Date.now(),
      },
    }),
  );

  ws.on("message", (rawData) => {
    const request = parseClientMessage(rawData.toString());
    if (!request) {
      send(
        serializeMessage({
          id: "parse-error",
          ok: false,
          error: makeError("INVALID_REQUEST", "无法解析请求，期望格式: { id, method, params }"),
        }),
      );
      return;
    }

    const respond = (ok: boolean, result?: unknown, error?: ReturnType<typeof makeError>) => {
      const frame: DocAssistantResponse = {
        id: request.id,
        ok,
        result,
        error,
      };
      send(serializeMessage(frame));
    };

    router.dispatch({ request, respond, client, state }).catch((error) => {
      console.error(`[doc-ws] 方法执行出错: method=${request.method}`, error);
      respond(false, undefined, makeError("INTERNAL_ERROR", String(error)));
    });
  });

  ws.on("close", () => {
    state.broadcaster.unregisterConn(connId);
  });

  ws.on("error", (error) => {
    console.error(`[doc-ws] 连接错误: connId=${connId}`, error);
  });
}

export function parseUrlQuery(url: string): Record<string, string> {
  try {
    const parsed = new URL(url, "http://localhost");
    const params: Record<string, string> = {};
    for (const [key, value] of parsed.searchParams) {
      params[key] = value;
    }
    return params;
  } catch {
    return {};
  }
}
