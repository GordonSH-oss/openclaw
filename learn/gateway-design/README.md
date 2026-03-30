# Mini Gateway

`learn/gateway-design` 是一个用于学习 OpenClaw `src/gateway` 设计的 control-plane 示例。它不只是“开一个 WebSocket 服务”，而是把协议、连接、方法路由、chat run 状态、session 元数据、transcript 查询和 channel 接入拆成了几层可单独理解的模块。

现在它已经不再自己维护所有底层逻辑，而是明确依赖：

- `learn/agent-design`
  - 提供 execution plane 的 `runLearningAgentCommand`
- `learn/channel-routing-design`
  - 提供 route 解析和 session key 语义
- `learn/session-memory-design`
  - 提供 session metadata / transcript 的持久化底层
- `learn/plugin-design`
  - 提供 plugin bootstrap 和 plugin gateway method 注入

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
  session-store.ts        # session-memory-design 的 gateway 适配层
  transcript-store.ts     # transcript 读取适配层，底层来自 session-memory-design
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

现在这两层的真正底座已经下沉到 `learn/session-memory-design`。Gateway 本地保留的是适配层，目的是让你看清 control-plane 为什么要消费这些持久化对象，而不是重新实现它们。

### 4. plugin bootstrap 也要放在 Gateway 装配阶段

`server-plugin-bootstrap.ts` 现在会加载 `learn/plugin-design`，把 mock plugin registry 并入 Gateway 启动流程。

这对应真实 OpenClaw 的关键认知：Gateway 不只是 RPC 服务器，它还是插件 runtime 的装配点。

### 5. `agent.wait` 和事件订阅一起构成长任务交互模型

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
8. `../channel-routing-design/src/route-resolver.ts`
9. `../session-memory-design/src/session-store.ts`
10. `../plugin-design/src/loader.ts`

## 运行和测试

```bash
cd learn/gateway-design
node --import tsx src/index.ts
npm test
```
