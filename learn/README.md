# Learn Roadmap

现在 `learn/` 不再只是两个 demo，而是五个互相配合的学习平面：

- `learn/gateway-design`
  - control plane：协议、连接、方法路由、run 跟踪、订阅面
- `learn/agent-design`
  - execution plane：command、attempt、runner、fallback、auth、skills、tools
- `learn/plugin-design`
  - plugin plane：manifest-first、capability registration、runtime registry、Plugin SDK 边界
- `learn/channel-routing-design`
  - routing plane：inbound normalization、bindings、route priority、session key、channel policy
- `learn/session-memory-design`
  - persistence plane：session metadata、append-only transcript、workspace memory、flush、maintenance

## 推荐顺序

### 第一层：先看大框架

1. `learn/code-reports/src-codebase-report.md`
2. `learn/learning-architecture-map.md`
3. `learn/code-reports/src-gateway-report.md`
4. `learn/code-reports/src-agents-report.md`

### 第二层：先打通 control plane + execution plane

5. `learn/gateway-design/src/protocol/index.ts`
6. `learn/gateway-design/src/server-runtime-state.ts`
7. `learn/gateway-design/src/methods/agent.ts`
8. `learn/agent-design/src/agent-command.ts`
9. `learn/agent-design/src/command/attempt-execution.ts`
10. `learn/agent-design/src/embedded-runner/run.ts`

### 第三层：补齐插件、路由和持久化边界

11. `learn/code-reports/src-plugins-report.md`
12. `learn/plugin-design/src/manifest.ts`
13. `learn/plugin-design/src/loader.ts`
14. `learn/code-reports/src-routing-report.md`
15. `learn/channel-routing-design/src/inbound-context.ts`
16. `learn/channel-routing-design/src/route-resolver.ts`
17. `learn/code-reports/src-sessions-memory-report.md`
18. `learn/session-memory-design/src/session-store.ts`
19. `learn/session-memory-design/src/transcript-store.ts`
20. `learn/session-memory-design/src/workspace-memory.ts`
21. `learn/session-memory-design/src/memory-flush.ts`

### 第四层：再回到 agent 内部支撑子系统

22. `learn/agent-design/src/model-fallback.ts`
23. `learn/agent-design/src/auth-profiles/order.ts`
24. `learn/agent-design/src/skills/workspace.ts`
25. `learn/agent-design/src/tools/runtime.ts`

## 关键学习目标

- 为什么 OpenClaw 要拆成 Gateway、Agent、Plugin、Routing、Session/Memory 五个平面
- 为什么 manifest-first discovery 和 runtime register 要分开
- 为什么 route 决定的是 agent / session 归属，而不是模型行为
- 为什么 session metadata 和 transcript 必须分层
- 为什么 transcript 属于短期记忆，而 workspace memory 属于长期记忆
- 为什么 long-running run 需要 accepted / wait / event 三套语义
- 为什么 fallback、auth profile、skills、tools 都是执行前后的“一等子系统”

## 本轮暂不做成 runnable package，但值得继续学的主题

- `src/auto-reply`
  - 回复回投、发送节流、typing / ack / delivery pipeline
- `src/commands`
  - onboarding、doctor、channel setup、operator UX
- `src/infra`
  - discovery、approval、安全、diagnostics、device identity
- `apps/*`
  - macOS / iOS / Android 节点与 UI surface
- `media` / `tts` / `image-generation` / `web-search`
  - 多模态和外部能力的运行时接线
