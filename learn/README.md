# Learn Roadmap

这个 `learn/` 目录现在拆成两个互相配合的学习工程：

- `learn/gateway-design`
  学 Gateway 作为 control plane 如何组织连接、协议、运行态和 session surface。
- `learn/agent-design`
  学 Agent 作为 execution plane 如何组织 command、attempt、runner、fallback、auth、skills 和 tools。

## 推荐顺序

1. `learn/code-reports/src-gateway-report.md`
2. `learn/gateway-design/src/protocol/index.ts`
3. `learn/gateway-design/src/server-runtime-state.ts`
4. `learn/gateway-design/src/methods/agent.ts`
5. `learn/code-reports/src-agents-report.md`
6. `learn/agent-design/src/agent-command.ts`
7. `learn/agent-design/src/command/attempt-execution.ts`
8. `learn/agent-design/src/embedded-runner/run.ts`
9. `learn/agent-design/src/model-fallback.ts`
10. `learn/agent-design/src/auth-profiles/order.ts`
11. `learn/agent-design/src/skills/workspace.ts`
12. `learn/agent-design/src/tools/runtime.ts`
13. `learn/agent-design/src/workspace-memory/files.ts`
14. `learn/agent-design/src/workspace-memory/index.ts`
15. `learn/agent-design/src/workspace-memory/flush.ts`

## 关键学习目标

- 为什么 Gateway 和 Agent 要分成两个 package
- 为什么 session metadata 和 transcript 要分层
- 为什么 long-running run 需要 accepted / wait / event 三套语义
- 为什么 Agent 入口和真正复杂的执行后端要拆开
- 为什么 fallback、auth profile、skills、tools 都是“一等子系统”
- 为什么 transcript 属于短期记忆，而 workspace memory 属于长期记忆
