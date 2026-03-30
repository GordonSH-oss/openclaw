import type { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { handleConnection, parseUrlQuery } from "./ws-connection.js";
import type { GatewayRuntimeState } from "./server-runtime-state.js";
import type { MethodRouter } from "./method-router.js";

export function attachGatewayWsHandlers(params: {
  httpServer: HttpServer;
  state: GatewayRuntimeState;
  router: MethodRouter;
}): WebSocketServer {
  const wss = new WebSocketServer({ server: params.httpServer });
  wss.on("connection", (ws, req) => {
    const query = parseUrlQuery(req.url ?? "");
    handleConnection(ws, query, params.state, params.router);
  });
  return wss;
}
