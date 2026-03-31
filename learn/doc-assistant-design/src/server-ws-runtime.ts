import type { Server as HttpServer } from "node:http";
import { WebSocketServer } from "./ws-runtime.js";
import { handleConnection, parseUrlQuery } from "./ws-connection.js";
import type { DocAssistantRuntimeState } from "./server-runtime-state.js";
import type { MethodRouter } from "./method-router.js";

export function attachDocAssistantWsHandlers(params: {
  httpServer: HttpServer;
  state: DocAssistantRuntimeState;
  router: MethodRouter;
}) {
  const wss = new WebSocketServer({ server: params.httpServer });
  wss.on("connection", (...args: unknown[]) => {
    const [ws, req] = args as [unknown, { url?: string }?];
    const query = parseUrlQuery(req?.url ?? "");
    handleConnection(
      ws as Parameters<typeof handleConnection>[0],
      query,
      params.state,
      params.router,
    );
  });
  return wss;
}
