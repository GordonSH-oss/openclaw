import { MethodRouter } from "./method-router.js";
import {
  docsAdminMemoryApproveHandler,
  docsAdminMemoryGetHandler,
  docsAdminMemoryListHandler,
  docsAdminMemoryRejectHandler,
  docsAdminMemoryUpdateHandler,
  docsAskHandler,
  docsHistoryListHandler,
  docsMethodsHandler,
  docsRunStatusHandler,
  docsRunWaitHandler,
  docsSearchPreviewHandler,
  docsStatusHandler,
  docsTranscriptGetHandler,
  docsUserCreateHandler,
} from "./methods/docs.js";

export function createDocAssistantRouter(): MethodRouter {
  const router = new MethodRouter();
  router
    .register("docs.user.create", docsUserCreateHandler, {
      description: "创建一个临时文档助手 user",
    })
    .register("docs.ask", docsAskHandler, {
      description: "执行一次文档检索问答 run（立即 accepted，异步完成）",
    })
    .register("docs.run.status", docsRunStatusHandler, {
      description: "查询 run 当前状态",
    })
    .register("docs.run.wait", docsRunWaitHandler, {
      description: "等待 run 进入终态",
    })
    .register("docs.session.transcript.get", docsTranscriptGetHandler, {
      description: "读取 temp user 的 transcript",
    })
    .register("docs.history.list", docsHistoryListHandler, {
      description: "读取历史提问与回答结果",
    })
    .register("docs.search.preview", docsSearchPreviewHandler, {
      description: "预览检索结果，不生成回答",
    })
    .register("docs.admin.memory.list", docsAdminMemoryListHandler, {
      description: "管理员读取 answer memory / review 队列",
      requiredScopes: ["admin"],
    })
    .register("docs.admin.memory.get", docsAdminMemoryGetHandler, {
      description: "管理员读取单条 answer memory",
      requiredScopes: ["admin"],
    })
    .register("docs.admin.memory.approve", docsAdminMemoryApproveHandler, {
      description: "管理员审批并发布标准答案",
      requiredScopes: ["admin"],
    })
    .register("docs.admin.memory.reject", docsAdminMemoryRejectHandler, {
      description: "管理员驳回 answer memory",
      requiredScopes: ["admin"],
    })
    .register("docs.admin.memory.update", docsAdminMemoryUpdateHandler, {
      description: "管理员编辑待审核答案",
      requiredScopes: ["admin"],
    })
    .register("docs.methods", docsMethodsHandler, {
      description: "列出所有文档助手方法",
    })
    .register("docs.status", docsStatusHandler, {
      description: "获取文档助手当前运行状态",
    });
  return router;
}
