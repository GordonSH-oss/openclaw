# Mini Gateway

`learn/gateway-design` 是一个用于学习 OpenClaw `src/gateway` 设计的 control-plane 示例。它不只是“开一个 WebSocket 服务”，而是把协议、连接、方法路由、chat run 状态、session 元数据、transcript 查询和 channel 接入拆成了几层可单独理解的模块。

## 当前结构

```text
src/
  protocol/
    index.ts              # Wire contract: request / response / event / validators
  server-runtime-state.ts # Gateway 活体状态：broadcaster / dedupe / chat run
  server-chat.ts          # active run、terminal run、message subscriber
  server-methods.ts       # 核心 RPC 方法注册表
  server-ws-runtime.ts    # 把 ws 连接层挂到 HTTP server
  server-plugin-bootstrap.ts
                         # 注册内置 mock channel，演示 plugin bootstrap 的位置
  session-store.ts        # 轻量 session metadata
  transcript-store.ts     # transcript 读取面，实际数据来自 agent package
  methods/
    agent.ts              # agent / agent.status / agent.wait / agent.cancel
    sessions.ts           # sessions.* / gateway.*
  routing.ts              # binding-based routing
  channels.ts             # mock channel plugin
  server.ts               # 总装配入口
```

## 学习重点

### 1. Gateway 是控制平面，不是执行引擎

`methods/agent.ts` 不直接跑 LLM，而是委托给 `learn/agent-design`。Gateway 只做：

- 接请求
- 校验权限和幂等
- 建立 session 语义
- 追踪 long-running run 状态
- 广播 delta / session change / transcript message

### 2. chat run 状态必须由 Gateway 自己维护

`server-chat.ts` 里专门维护：

- `activeRuns`
- `terminalRuns`
- `sessionMessageSubscribers`

这是为了说明为什么真实 OpenClaw 的 gateway 不只是“转发一下请求”，而要长期持有运行态。

### 3. session metadata 和 transcript 是两层

- `session-store.ts` 管理小而频繁更新的元数据
- `transcript-store.ts` 提供 transcript 查询入口

学习版里 transcript 实际由 `learn/agent-design` 负责写入，Gateway 通过 public API 读取，借此把 control-plane / execution-plane 的边界讲清楚。

### 4. `agent.wait` 和事件订阅一起构成长任务交互模型

学习版同时保留两条消费路径：

- `agent.wait`
- `sessions.subscribe`
- `sessions.messages.subscribe`

这和真实系统里“立即 accepted + 之后异步观测终态”的交互非常接近。

## 推荐阅读顺序

1. `src/protocol/index.ts`
2. `src/server-runtime-state.ts`
3. `src/server-chat.ts`
4. `src/methods/agent.ts`
5. `src/methods/sessions.ts`
6. `src/server.ts`
7. `src/routing.ts` 和 `src/channels.ts`

## 运行和测试

```bash
cd learn/gateway-design
node --import tsx src/index.ts
node --import tsx --test src/**/*.test.ts
```
