/**
 * server.ts — Gateway 装配入口
 *
 * 【这里是整个 Gateway 的"总装配"】
 *
 * 上面的所有模块都是零散的组件，这里把它们组装成一个运行中的服务：
 *
 *   协议 + 运行时状态 + 方法路由 + 连接处理 + Channel 启动
 *         ↓
 *   一个完整的、可运行的 Gateway
 *
 * 类比：
 * - runtime-state.ts 是"零件仓库"
 * - method-router.ts 是"控制板"
 * - ws-connection.ts 是"门卫"
 * - server.ts 是"建筑师"，把门、控制板、仓库都装到一栋大楼里
 */

import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createGatewayRuntimeState } from "./runtime-state.js";
import { MethodRouter } from "./method-router.js";
import { handleConnection, parseUrlQuery } from "./ws-connection.js";
import { ChannelRegistry, MockChannel } from "./channels.js";
import { resolveAgentRoute } from "./routing.js";
import { getOrCreateSession } from "./sessions.js";
import { runAgentTurn } from "./agent-runner.js";
import type { BindingRule } from "./routing.js";

// ── 导入所有 method handlers ──────────────────────────────────────
import {
  agentHandler,
  agentStatusHandler,
  agentCancelHandler,
} from "./methods/agent.js";
import {
  sessionsListHandler,
  sessionsGetHandler,
  sessionsDeleteHandler,
  sessionsSubscribeHandler,
  sessionsUnsubscribeHandler,
  sessionsTranscriptGetHandler,
  gatewayMethodsHandler,
  gatewayStatusHandler,
} from "./methods/sessions.js";

// ─── Gateway 配置 ─────────────────────────────────────────────────────────────

export type GatewayConfig = {
  /** 监听端口（默认 8789） */
  port?: number;
  /** 绑定地址（默认 "127.0.0.1"，只允许本地连接） */
  host?: string;
  /** Binding 规则（消息路由配置） */
  bindings?: BindingRule[];
  /** 默认 agent ID */
  defaultAgentId?: string;
};

// ─── 创建并启动 Gateway ────────────────────────────────────────────────────────

export async function createGateway(config: GatewayConfig = {}) {
  const port = config.port ?? 8789;
  const host = config.host ?? "127.0.0.1";
  const bindings = config.bindings ?? [];
  const defaultAgentId = config.defaultAgentId ?? "default";

  // ── Step 1：创建运行时状态容器 ─────────────────────────────────
  // 这是整个 Gateway 的"世界状态"，所有 handler 都通过这个对象读写状态
  const state = createGatewayRuntimeState();

  // ── Step 2：创建 channel 注册表并注册 channels ─────────────────
  const channelRegistry = new ChannelRegistry();

  // 注册 mock channel（用于测试）
  // 生产环境里，这里注册真实的 Telegram、Discord 等 channel 插件
  const mockChannel = new MockChannel();
  channelRegistry.register(mockChannel);

  // ── Step 3：定义 channel 消息处理回调 ────────────────────────
  // 这是 channel 消息进入 Gateway 的统一入口
  const onChannelMessage = async (msg: { body: string; source: Parameters<typeof resolveAgentRoute>[0]["source"]; timestamp: number }) => {
    console.log(`[gateway] 收到 channel 消息: channel=${msg.source.channel} body="${msg.body.slice(0, 50)}"`);

    // 路由：决定哪个 agent 处理这条消息
    const route = resolveAgentRoute({
      source: msg.source,
      bindings,
      defaultAgentId,
    });

    console.log(`[gateway] 路由结果: agentId=${route.agentId} sessionKey=${route.sessionKey} matchedBy=${route.matchedBy}`);

    // 加载/创建 session
    const { entry: sessionEntry } = await getOrCreateSession(route.sessionKey, {
      lastChannel: msg.source.channel,
      lastTo: msg.source.accountId,
    });

    // 执行 agent turn（channel 消息不走幂等检查，直接执行）
    const runId = `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const result = await runAgentTurn(
        {
          runId,
          message: msg.body,
          sessionKey: route.sessionKey,
          sessionEntry,
        },
        state,
      );

      // 通过 channel 发送回复
      const channelPlugin = channelRegistry.get(msg.source.channel);
      if (channelPlugin) {
        await channelPlugin.sendReply(
          {
            channel: msg.source.channel,
            to: msg.source.accountId ?? msg.source.peer?.id ?? "unknown",
          },
          result.reply,
        );
      }
    } catch (err) {
      console.error(`[gateway] channel 消息处理失败:`, err);
    }
  };

  // ── Step 4：启动所有 channel ───────────────────────────────────
  await channelRegistry.startAll(onChannelMessage as Parameters<typeof channelRegistry.startAll>[0]);

  // ── Step 5：创建方法路由器并注册所有方法 ─────────────────────
  // 这是 Gateway RPC 的"路由表"
  const router = new MethodRouter();

  // agent 相关方法（需要 admin 权限）
  router
    .register("agent", agentHandler, {
      requiredScopes: ["admin"],
      description: "执行一次 agent turn（发消息给 AI）",
    })
    .register("agent.status", agentStatusHandler, {
      description: "查询 run 状态",
    })
    .register("agent.cancel", agentCancelHandler, {
      requiredScopes: ["admin"],
      description: "取消正在运行的 run",
    });

  // session 相关方法
  router
    .register("sessions.list", sessionsListHandler, {
      description: "列出所有 sessions",
    })
    .register("sessions.get", sessionsGetHandler, {
      description: "获取单个 session 详情",
    })
    .register("sessions.delete", sessionsDeleteHandler, {
      requiredScopes: ["admin"],
      description: "删除 session",
    })
    .register("sessions.subscribe", sessionsSubscribeHandler, {
      description: "订阅 session 变更事件",
    })
    .register("sessions.unsubscribe", sessionsUnsubscribeHandler, {
      description: "取消订阅 session 变更事件",
    })
    .register("sessions.transcript.get", sessionsTranscriptGetHandler, {
      description: "获取 session 对话历史（transcript）",
    });

  // Gateway 自身的状态/文档方法
  router
    .register("gateway.methods", gatewayMethodsHandler, {
      description: "列出所有 Gateway 方法",
    })
    .register("gateway.status", gatewayStatusHandler, {
      description: "获取 Gateway 运行状态",
    });

  // ── Step 6：创建 HTTP + WebSocket 服务器 ──────────────────────
  const httpServer = createServer((req, res) => {
    // 简单的 HTTP 健康检查端点
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          connections: state.broadcaster.getConnCount(),
          activeRuns: state.activeRuns.size,
          uptime: process.uptime(),
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
  });

  const wss = new WebSocketServer({ server: httpServer });

  // ── Step 7：处理新的 WebSocket 连接 ───────────────────────────
  wss.on("connection", (ws, req) => {
    const query = parseUrlQuery(req.url ?? "");
    // 把连接处理委托给 ws-connection.ts
    // ws-connection.ts 负责连接生命周期，业务逻辑在 router 里
    handleConnection(ws, query, state, router);
  });

  // ── Step 8：启动服务器 ────────────────────────────────────────
  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      console.log(`\n🚀 Mini Gateway 已启动`);
      console.log(`   WebSocket: ws://${host}:${port}`);
      console.log(`   Health:    http://${host}:${port}/health`);
      console.log(`\n已注册方法：`);
      for (const { method, description } of router.listMethods()) {
        console.log(`   ${method.padEnd(30)} ${description ?? ""}`);
      }
      console.log(`\n已注册 channels：${channelRegistry.listIds().join(", ")}`);
      console.log(`\n数据目录：~/.mini-gateway/`);
      console.log(`   sessions:    ~/.mini-gateway/sessions.json`);
      console.log(`   transcripts: ~/.mini-gateway/transcripts/\n`);
      resolve();
    });
  });

  // ── 返回控制接口（用于测试和关闭）─────────────────────────────
  return {
    state,
    router,
    channelRegistry,
    mockChannel,  // 暴露 mock channel 用于测试

    /** 关闭 Gateway */
    async close() {
      await channelRegistry.stopAll();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      console.log("[gateway] 已关闭");
    },
  };
}
