import { createServer } from "node:http";
import { createGatewayRuntimeState } from "./server-runtime-state.js";
import { resolveAgentRoute } from "./routing.js";
import type { BindingRule } from "./routing.js";
import { bootstrapGatewayChannels } from "./server-plugin-bootstrap.js";
import { createCoreGatewayRouter } from "./server-methods.js";
import { attachGatewayWsHandlers } from "./server-ws-runtime.js";
import { getOrCreateSession } from "./session-store.js";
import { launchGatewayAgentRun } from "./methods/agent.js";

export type GatewayConfig = {
  port?: number;
  host?: string;
  bindings?: BindingRule[];
  defaultAgentId?: string;
};

export async function createGateway(config: GatewayConfig = {}) {
  const port = config.port ?? 8789;
  const host = config.host ?? "127.0.0.1";
  const bindings = config.bindings ?? [];
  const defaultAgentId = config.defaultAgentId ?? "default";

  const state = createGatewayRuntimeState();
  const { channelRegistry, mockChannel, pluginRegistry } = await bootstrapGatewayChannels();

  const onChannelMessage = async (msg: {
    body: string;
    source: Parameters<typeof resolveAgentRoute>[0]["source"];
    timestamp: number;
  }) => {
    const route = resolveAgentRoute({
      source: msg.source,
      bindings,
      defaultAgentId,
    });
    const { entry } = await getOrCreateSession(route.sessionKey, {
      lastChannel: msg.source.channel,
    });
    const run = launchGatewayAgentRun({
      state,
      message: msg.body,
      sessionKey: route.sessionKey,
      sessionId: entry.sessionId,
      runId: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const terminal = await run.completion;
    if (!terminal.reply) {
      return;
    }
    const channel = channelRegistry.get(msg.source.channel);
    if (!channel) {
      return;
    }
    await channel.sendReply(
      {
        channel: msg.source.channel,
        to: msg.source.accountId ?? msg.source.peer?.id ?? "unknown",
      },
      terminal.reply,
    );
  };

  await channelRegistry.startAll(onChannelMessage as Parameters<typeof channelRegistry.startAll>[0]);

  const router = createCoreGatewayRouter();
  for (const method of pluginRegistry.gatewayMethods) {
    router.register(method.name, async ({ request, respond }) => {
      const payload =
        typeof request.params === "object" && request.params !== null
          ? (request.params as Record<string, unknown>)
          : {};
      respond(true, await method.handle(payload));
    }, {
      description: `Plugin gateway method from ${method.name}`,
    });
  }
  const httpServer = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          connections: state.broadcaster.getConnCount(),
          activeRuns: state.chat.activeRuns.size,
          uptime: process.uptime(),
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
  });
  const wss = attachGatewayWsHandlers({
    httpServer,
    state,
    router,
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      console.log(`\nMini Gateway 已启动`);
      console.log(`WebSocket: ws://${host}:${port}`);
      console.log(`Health:    http://${host}:${port}/health`);
      console.log(`\n已注册方法：`);
      for (const { method, description } of router.listMethods()) {
        console.log(`  ${method.padEnd(30)} ${description ?? ""}`);
      }
      resolve();
    });
  });

  return {
    state,
    router,
    channelRegistry,
    mockChannel,
    pluginRegistry,
    wss,
    async close() {
      await channelRegistry.stopAll();
      wss.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
