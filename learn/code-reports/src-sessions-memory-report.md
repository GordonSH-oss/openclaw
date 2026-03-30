# OpenClaw `src/sessions` + Memory 主线深读报告

## 1. 模块定位

OpenClaw 的 session 和 memory 不是一个东西，但它们共同组成了“记忆系统”。

可以把它理解成两层：

- 短期记忆
  - session metadata
  - transcript
- 长期记忆
  - `MEMORY.md` / `memory.md`
  - `memory/YYYY-MM-DD.md`
  - 检索索引和 flush 生命周期

很多理解误区都来自把它们混成一个“memory 对象”。

## 2. 真实系统里各自负责什么

### 2.1 `src/sessions/*`

负责：

- session id / session key 解析
- session lifecycle 事件
- model override / send policy 等 session 级行为

### 2.2 transcript

真实 transcript 主要体现在 session store 和 transcript 读写面里。它更像 append-only 历史层，而不是频繁改写的状态对象。

### 2.3 memory

配套概念主要在：

- `docs/concepts/memory.md`
- `src/agents/memory-search.ts`
- `packages/memory-host-sdk/*`

这里的关键点是：

- memory files 是 source of truth
- memory index / vector search 是检索视图
- pre-compaction flush 是生命周期动作

## 3. 设计特征

### 3.1 session metadata 和 transcript 分层

session entry 很适合小而频繁更新：

- `updatedAt`
- `status`
- token 统计

transcript 更适合 append-only：

- 保留完整对话历史
- 适合顺序读取和回放

### 3.2 长期记忆必须落到文件

OpenClaw 的 memory 不是“模型脑子里记住了”，而是 durable note 被写回 workspace Markdown。

### 3.3 flush 是 session 与 memory 的桥

当 session 接近 compaction 时，系统会触发 silent flush，把近期上下文里值得长期保留的内容写回 memory。

## 4. 推荐阅读顺序

1. `docs/concepts/session.md`
2. `docs/concepts/memory.md`
3. `src/sessions/session-id-resolution.ts`
4. `src/sessions/transcript-events.ts`
5. `src/sessions/session-lifecycle-events.ts`
6. `src/agents/memory-search.ts`
7. `packages/memory-host-sdk/src/runtime-core.ts`

## 5. 与 `learn/session-memory-design` 的映射

为了把这条主线做成可运行的学习工程，`learn/session-memory-design` 现在映射了：

- `session-store.ts`
  - 对应 session metadata 层
  - 学习版保留 `sessionId/sessionKey/status/usage/updatedAt` 这些小而频繁更新字段。
- `transcript-store.ts`
  - 对应 append-only transcript 层
  - 学习版保留 JSONL 和线性 DAG 风格 parentId。
- `session-lifecycle.ts`
  - 对应 session create/update/reset/delete 语义。
- `session-maintenance.ts`
  - 对应真实系统里的 prune / cap / rotate 一类维护问题。
- `workspace-memory.ts`
  - 对应 memory files 主线
  - 学习版保留 `MEMORY.md` 和 `memory/YYYY-MM-DD.md`。
- `memory-index.ts`
  - 对应 memory search 的最小索引层
  - 学习版保留 chunk + lexical search，不上 SQLite/vector。
- `memory-flush.ts`
  - 对应 pre-compaction memory flush
  - 学习版保留“从热上下文提炼 durable note，再写回长期记忆”的主线。
- `events.ts`
  - 对应 `sessions.changed`、`transcript.message`、`memory.updated` 三类可观测事件。

## 6. 为什么这层要独立成学习包

如果把 session / transcript / memory 全塞进 gateway 或 agent 里，初学时很容易误以为它们只是局部实现细节。实际上它们是一套横跨 control plane 和 execution plane 的基础持久化边界。

把它单独抽出来之后，更容易看清：

- Gateway 为什么要读 session / transcript
- Agent 为什么要写 transcript / flush memory
- Route 为什么必须稳定地产出 session key
