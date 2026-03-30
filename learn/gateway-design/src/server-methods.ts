import { MethodRouter } from "./method-router.js";
import {
  agentHandler,
  agentStatusHandler,
  agentWaitHandler,
  agentCancelHandler,
} from "./methods/agent.js";
import {
  gatewayMethodsHandler,
  gatewayStatusHandler,
  sessionsDeleteHandler,
  sessionsGetHandler,
  sessionsListHandler,
  sessionsMessagesSubscribeHandler,
  sessionsMessagesUnsubscribeHandler,
  sessionsSubscribeHandler,
  sessionsTranscriptGetHandler,
  sessionsUnsubscribeHandler,
} from "./methods/sessions.js";

export function createCoreGatewayRouter(): MethodRouter {
  const router = new MethodRouter();
  router
    .register("agent", agentHandler, {
      requiredScopes: ["admin"],
      description: "执行一次 agent turn（立即 accepted，异步完成）",
    })
    .register("agent.status", agentStatusHandler, {
      description: "查询 run 当前状态",
    })
    .register("agent.wait", agentWaitHandler, {
      description: "等待 run 进入终态",
    })
    .register("agent.cancel", agentCancelHandler, {
      requiredScopes: ["admin"],
      description: "取消一个正在执行的 run",
    })
    .register("sessions.list", sessionsListHandler, {
      description: "列出所有 session 元数据",
    })
    .register("sessions.get", sessionsGetHandler, {
      description: "获取单个 session 元数据",
    })
    .register("sessions.delete", sessionsDeleteHandler, {
      requiredScopes: ["admin"],
      description: "删除 session 和 transcript",
    })
    .register("sessions.subscribe", sessionsSubscribeHandler, {
      description: "订阅 session 列表级事件",
    })
    .register("sessions.unsubscribe", sessionsUnsubscribeHandler, {
      description: "取消订阅 session 列表级事件",
    })
    .register("sessions.messages.subscribe", sessionsMessagesSubscribeHandler, {
      description: "订阅单个 session 的 transcript/message 事件",
    })
    .register("sessions.messages.unsubscribe", sessionsMessagesUnsubscribeHandler, {
      description: "取消订阅单个 session 的 transcript/message 事件",
    })
    .register("sessions.transcript.get", sessionsTranscriptGetHandler, {
      description: "读取 session transcript",
    })
    .register("gateway.methods", gatewayMethodsHandler, {
      description: "列出可用 Gateway 方法",
    })
    .register("gateway.status", gatewayStatusHandler, {
      description: "获取 Gateway 当前运行状态",
    });
  return router;
}
