# Mini Agent Design

`learn/agent-design` 是一个用于学习 agent 执行架构的中高保真示例。它对应 OpenClaw 的 `src/agents`，重点不是接真实模型，而是把一次 agent run 从入口、session、attempt、runner、fallback、auth profile、skills、tools 一直到 transcript 落盘完整走通。

现在它的底层支撑已经显式拆给两个兄弟学习包：

- `learn/session-memory-design`
  - 提供 session、transcript、workspace memory、memory flush
- `learn/plugin-design`
  - 提供 memory runtime 和 gateway method 等 plugin consumption surface

## 模块分层

```text
agent-command.ts
  ↓
command/
  session.ts
  run-context.ts
  attempt-execution.ts
  ↓
embedded-runner/ 或 cli-runner/
  ↓
model-fallback.ts
auth-profiles/*
skills/*
tools/*
transcript/*
workspace-memory/*

其中：

- `transcript/*` 和 `workspace-memory/*`
  - 现在主要是对 `learn/session-memory-design` 的学习适配层
- `tools/runtime.ts`
  - 现在会优先尝试消费 `learn/plugin-design` 里的 active plugin registry
```

## 学习重点

- `agent-command.ts`
  看执行前准备：参数校验、session 解析、skill snapshot、model candidate、auth profile 顺序。
- `command/attempt-execution.ts`
  看同一个上层请求如何被派发到 embedded/cli 两种执行后端。
- `embedded-runner/run.ts`
  看 prompt 组装、历史读取、tool loop、delta 流、最终 transcript 写入。
- `model-fallback.ts`
  看 timeout、rate_limit、auth 失败如何触发候选模型切换。
- `auth-profiles/order.ts`
  看 profile cooldown 和 preferred profile 如何一起决定尝试顺序。
- `skills/workspace.ts`
  看 skill root 扫描、路径越界防护和 prompt snapshot。
- `workspace-memory/*`
  看长期记忆如何从 workspace Markdown 文件、最小索引层和 pre-compaction flush 三部分组成。

## 长期记忆在学习版中的实现

现在 learning 版把 OpenClaw 的长期记忆链路也补上了，不过保持了可读优先的简化：

- `src/workspace-memory/files.ts`
  - 管理 `MEMORY.md` / `memory.md`
  - 管理 `memory/YYYY-MM-DD.md`
  - 提供读取、枚举、写入 daily memory 的基础 API
- `src/workspace-memory/index.ts`
  - 把 Markdown 记忆文件切成 chunk
  - 生成本地 JSON index
  - 提供最小可读的 `memory_search`
- `src/workspace-memory/flush.ts`
  - 模拟真实 OpenClaw 的 pre-compaction memory flush
  - transcript 足够长时，把近期上下文摘要写入 daily memory
- `src/tools/runtime.ts`
  - 新增 `memory_search`、`memory_get`、`memory_write`
- `src/embedded-runner/run.ts`
  - 启动时加载 curated memory 摘要
  - 运行中可通过 memory tools 读写长期记忆
  - 运行后根据 transcript 长度决定是否触发 memory flush

建议把它和 session / transcript 一起理解成两层记忆：

- 短期记忆
  - 真正的底层在 `learn/session-memory-design/src/transcript-store.ts`
  - `src/transcript/store.ts` 是适配层
- 长期记忆
  - 真正的底层在 `learn/session-memory-design/src/workspace-memory.ts`
  - `src/workspace-memory/*` 是学习版 agent 对这套能力的消费面

这样读会更接近 OpenClaw 的真实心智模型：不是“有一个统一 memory 对象”，而是 transcript、workspace memory、检索索引、flush 生命周期共同组成记忆系统。

## 一次 run 的执行链路

如果你想顺着代码真正走一遍，推荐按下面的顺序：

1. `src/agent-command.ts`
   入口编排层。先看它如何把 message、session、skills、auth、fallback 收束成一次可执行 run。
2. `src/command/run-context.ts`
   看执行前有哪些默认值和上下文会被统一归一化。
3. `src/command/session.ts`
   看 session metadata 和 transcript 文件路径如何被解析出来。
4. `src/model-fallback.ts`
   看为什么“先决定候选和失败策略，再进入 runner”会比把 fallback 写死在 runner 里更清楚。
5. `src/command/attempt-execution.ts`
   看同一个 attempt 如何切换 embedded / cli 两种执行后端。
6. `src/embedded-runner/run.ts`
   看真正的 runtime：用户消息、tool roundtrip、delta streaming、assistant 落盘。
7. `src/tools/runtime.ts`
   看 tool call 是如何从 prompt 语义转换成结构化执行的，包括长期记忆工具。
8. `src/workspace-memory/files.ts` 和 `src/workspace-memory/index.ts`
   看长期记忆文件与检索索引是怎么组织起来的。
9. `src/workspace-memory/flush.ts`
   看为什么“会话快变长时先把 durable notes 写回记忆”是合理的设计。
10. `src/transcript/store.ts`
    最后看所有消息如何被 append-only 写入 transcript。
11. `../session-memory-design/src/index.ts`
    再回头看真正的 session / transcript / memory 底层是如何独立成 persistence plane 的。
12. `../plugin-design/src/index.ts`
    最后看 agent tools 为什么能消费 plugin 提供的 memory runtime / gateway method。

## 建议怎么读代码里的注释

代码里的注释不是在解释“这一行做了什么”，而是在解释三类更重要的问题：

- 这个模块在整个 agent 架构里扮演什么角色
- 为什么这部分逻辑要放在这一层，而不是别的层
- learning 版保留了真实架构的哪条主线，又省略了哪些复杂度

如果你一边读一边对照 `learn/code-reports/src-agents-report.md`，会更容易把“抽象理解”和“可运行代码”对起来。

## 和 OpenClaw `src/agents` 的关系

- 这里保留了 OpenClaw 的主要分层和职责边界。
- 这里故意不接真实 provider SDK，也不实现真实 sandbox、ACP、远端节点和复杂 compaction。
- 长期记忆检索层这里用的是最小 JSON chunk index，用来解释“记忆文件”和“检索索引”为什么要分开；真实 OpenClaw 还会走 SQLite/vector/hybrid search。
- 这个项目追求的是“把设计讲明白”，不是“把所有复杂度复制一遍”。
