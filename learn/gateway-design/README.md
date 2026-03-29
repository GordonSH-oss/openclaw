# Mini Gateway —— 初学者 Gateway 设计学习指南

本目录是一个**可运行的最小化 Gateway 实现**，用于理解 OpenClaw 那样的本地 AI 助手网关的核心设计模式。

---

## 一、Gateway 是什么？

在 OpenClaw 体系里，"Gateway" 不是简单的 HTTP API 服务器，而是一个**本地控制平面（Local Control Plane）**。

它的职责是把以下这些本来分散的能力聚合到一个统一的运行时：

| 能力 | 说明 |
|------|------|
| 连接管理 | 接受来自 App / Web UI / CLI 的 WebSocket 连接 |
| 消息路由 | 把来自各个 channel（Telegram、Discord、Web）的消息路由到正确的 agent session |
| Agent 执行 | 触发 LLM 推理、工具调用，返回回复 |
| Session 管理 | 创建、持久化、查询会话状态 |
| 事件广播 | 把 agent 输出实时推送给所有连接的客户端 |
| 插件/Channel 注册 | 允许 channel 插件注册进来，Gateway 统一分发 |

**Gateway 是调度中枢，不是执行引擎**。真正跑 LLM 推理的是 `AgentRunner`，Gateway 只负责把请求送进去，把结果送出来。

---

## 二、核心分层设计

```
┌─────────────────────────────────────────────────┐
│                  客户端层                         │
│   macOS App / Web UI / CLI / Channel Plugin       │
└────────────────────┬────────────────────────────┘
                     │ WebSocket (JSON-RPC 风格)
┌────────────────────▼────────────────────────────┐
│               连接层 (ws-connection.ts)           │
│   握手 · 认证 · 连接生命周期 · Presence           │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│            方法路由层 (method-router.ts)           │
│   接收 RPC 请求 → 按 method 名分发 → 权限检查     │
└──────┬──────────────────────┬────────────────────┘
       │                      │
┌──────▼──────┐        ┌──────▼──────┐
│  methods/   │        │  methods/   │
│  agent.ts   │        │  sessions.ts │
│  (agent执行) │        │  (会话管理)  │
└──────┬──────┘        └──────┬──────┘
       │                      │
┌──────▼──────────────────────▼────────────────────┐
│              运行时状态层 (runtime-state.ts)        │
│   broadcaster · dedupe · chatAbortControllers     │
└──────┬──────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────┐
│             Agent 执行层 (agent-runner.ts)         │
│   调用 LLM API · 工具执行 · 流式输出 · 结果返回    │
└──────┬──────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────┐
│             持久化层 (sessions.ts)                 │
│   session store (JSON) · transcript (JSONL DAG)  │
└─────────────────────────────────────────────────┘
```

---

## 三、关键设计模式

### 3.1 协议优先（Protocol-First）

在写任何实现之前，先定义**线协议（wire protocol）**。

```typescript
// protocol.ts
export type GatewayRequest = {
  id: string;          // 客户端生成的请求 ID
  method: string;      // 方法名，如 "agent"、"sessions.list"
  params: unknown;     // 方法参数
};

export type GatewayResponse = {
  id: string;          // 对应请求的 ID
  ok: boolean;         // 是否成功
  result?: unknown;    // 成功时的返回值
  error?: { code: string; message: string };
};

export type GatewayEvent = {
  event: string;       // 事件名，如 "sessions.changed"、"agent.delta"
  data: unknown;       // 事件数据
};
```

**为什么要协议优先？**

- 任何 client（App、Web、CLI）都依赖这个 contract，不能随便改
- 协议变更是 breaking change，需要版本化
- 协议定义清楚，测试和 mock 才容易写

---

### 3.2 运行时状态容器（Runtime State Container）

Gateway 的"活体状态"集中在一个对象里，而不是散落在各处：

```typescript
// runtime-state.ts
export type GatewayRuntimeState = {
  // 广播器：向所有连接的客户端推送事件
  broadcaster: EventBroadcaster;
  
  // 幂等去重：防止同一个请求执行两次
  dedupe: Map<string, DedupeEntry>;
  
  // 正在执行的 agent run：runId → AbortController
  activeRuns: Map<string, { abort: AbortController; sessionKey: string }>;
  
  // 订阅了 session 事件的连接 ID 集合
  sessionSubscribers: Set<string>;
};
```

**为什么要有这个容器？**

- 避免全局变量散落（全局变量难测试、难追踪生命周期）
- `server.ts` 负责创建它，`methods/*` 只是接收和使用
- 代表了 Gateway 的"世界状态"，调试时只需要看这一个对象

---

### 3.3 非阻塞 Agent 执行模式

**关键设计**：Gateway 收到 `agent` 请求后，立即响应 `accepted`，然后异步执行：

```
客户端发送请求
     │
     ▼
Gateway 校验参数、更新 session 元数据
     │
     ▼
立即回复 { status: "accepted", runId: "xxx" }  ← 客户端不被阻塞
     │
     ▼ (异步)
AgentRunner.run(...)
     │
     ▼
执行完成 → respond(true, { status: "ok", result })
              + 广播 sessions.changed 事件
```

**为什么这么设计？**

- LLM 推理可能需要 30s~几分钟
- 客户端不应该等这么久才知道请求有没有被接受
- 客户端通过 `agent.wait` RPC 或订阅 `sessions.changed` 事件来知道结果

---

### 3.4 消息路由（Binding-Based Routing）

来自不同 channel 的消息，通过一套"binding 规则"决定由哪个 agent 处理：

```
Telegram 消息 (userId: 123456)
     │
     ▼ resolveAgentRoute()
  检查 bindings 配置:
  - binding 1: channel=telegram, peer=user:123456 → agentId="alice"  ← 命中
  - binding 2: channel=telegram, accountId=* → agentId="default"
     │
     ▼
sessionKey = "alice/telegram/user:123456"
agentId = "alice"
```

路由结果包含 `sessionKey`——这是 session 的唯一标识，也是 transcript 文件的关键。

---

### 3.5 Session 两层持久化

```
Session Store (sessions.json)          Transcript (sessions/<id>.jsonl)
─────────────────────────────          ───────────────────────────────
轻量级元数据：                           完整对话历史：
- sessionId (UUID)                     - { role: "user", content, timestamp }
- model / provider                     - { role: "assistant", content, usage }
- token counts                         - { role: "tool", toolName, result }
- lastChannel / lastTo                 - parentId 链（DAG 结构）
- status / startedAt / endedAt
- skillsSnapshot
```

**为什么分两层？**

- Session store 需要频繁读写（每次 turn 都更新），保持小体积
- Transcript 是 append-only，只增不减（compaction 压缩除外）
- 两者可以独立查询：列出所有 sessions 只需要读 store，不需要读所有 transcript

---

### 3.6 Transcript 的 DAG 结构

Transcript 不是简单的数组，而是一个**有向无环图（DAG）**，每条消息都有 `parentId` 指向前一条：

```
msg_001 (system)
   └── msg_002 (user: "你好")
           └── msg_003 (assistant: "你好！有什么我可以帮你？")
                   └── msg_004 (user: "帮我写段代码")
                           └── msg_005 (assistant thinking)
                           └── msg_006 (tool: execute_code)
                           └── msg_007 (assistant: "这是代码...")
```

**为什么用 DAG？**

- 支持分支（比如 subagent spawning）
- 支持 compaction：可以安全地把旧历史"压缩"成一个 summary 节点，只需断开旧 parent，接到新节点
- 不能直接追加原始 JSONL，否则缺失 `parentId` 会导致历史截断

---

## 四、文件结构说明

```
src/
  protocol.ts          # 线协议类型定义（Request/Response/Event）
  runtime-state.ts     # Gateway 运行时状态容器
  routing.ts           # 消息路由（channel + accountId → agent + sessionKey）
  sessions.ts          # Session Store + Transcript 持久化
  channels.ts          # Channel 插件接口和注册表
  ws-connection.ts     # WebSocket 连接生命周期
  method-router.ts     # RPC 方法分发和权限检查
  agent-runner.ts      # Agent 执行引擎（调用 LLM）
  methods/
    agent.ts           # "agent" RPC 方法实现
    sessions.ts        # "sessions.*" RPC 方法实现
  server.ts            # Gateway 装配入口（把上面所有东西组合起来）
  index.ts             # 启动入口
```

**读代码建议顺序：**

1. `protocol.ts` — 先理解数据结构
2. `routing.ts` — 理解消息如何路由
3. `sessions.ts` — 理解 session/memory 如何持久化
4. `runtime-state.ts` — 理解运行时状态容器
5. `ws-connection.ts` — 理解单连接生命周期
6. `method-router.ts` — 理解 RPC 分发
7. `methods/agent.ts` — 理解 agent 执行的完整流程
8. `server.ts` — 最后看 Gateway 如何组装

---

## 五、运行方式

```bash
cd learn/gateway-design
npm install
npm run dev
```

然后用 wscat 或者任意 WebSocket 客户端连接 `ws://localhost:8789`。

发送一个 agent 请求：

```json
{
  "id": "req-001",
  "method": "agent",
  "params": {
    "message": "你好！",
    "sessionKey": "default/main",
    "idempotencyKey": "idem-001"
  }
}
```

---

## 六、设计原则总结

| 原则 | 在代码中的体现 |
|------|----------------|
| **分层清晰** | protocol → connection → router → methods → runner → persistence |
| **协议优先** | `protocol.ts` 是系统对外合同，不随便改 |
| **非阻塞执行** | `agent` 方法立即返回 accepted，异步执行 |
| **控制面与数据面分离** | Gateway 是控制面（调度），AgentRunner 是数据面（执行） |
| **状态集中** | RuntimeState 是唯一的"世界状态"容器，避免散落全局变量 |
| **幂等保护** | dedupe map 防止重复执行 |
| **事件驱动** | 执行完成后通过广播器推送事件，客户端被动更新 |
