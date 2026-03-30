# Learning Architecture Map

这份文档的目标不是解释单个模块，而是告诉你 OpenClaw 最值得学习的几个“架构平面”是什么，以及它们在 `/learn` 里分别由哪个学习工程承载。

## 1. Control Plane

对应真实代码：

- `src/gateway/*`
- `docs/gateway/*`

学习工程：

- `learn/gateway-design`

核心问题：

- 请求如何进入系统
- 长任务如何 accepted / wait / status / cancel
- session 事件和 transcript 事件如何广播
- 为什么 Gateway 必须持有活体状态

## 2. Execution Plane

对应真实代码：

- `src/agents/*`
- `docs/concepts/agent.md`
- `docs/concepts/model-failover.md`

学习工程：

- `learn/agent-design`

核心问题：

- 一次 agent run 如何从入口走到 runner
- fallback、auth、skills、tools 如何参与执行
- embedded runner 和 CLI runner 为什么要保持统一结果合同

## 3. Plugin Plane

对应真实代码：

- `src/plugins/*`
- `src/plugin-sdk/*`
- `docs/plugins/*`

学习工程：

- `learn/plugin-design`

核心问题：

- 为什么要先读 manifest 再决定是否加载 runtime
- 为什么 registry 才是系统消费面
- 为什么 Plugin SDK 是边界，而不是方便的“内部 import 别人代码”

## 4. Routing Plane

对应真实代码：

- `src/channels/*`
- `src/routing/*`
- `docs/channels/channel-routing.md`

学习工程：

- `learn/channel-routing-design`

核心问题：

- inbound message 如何先被标准化
- route 如何按 peer > parent peer > account > channel > default 解析
- session key 为什么是上下文隔离和并发控制的基础

## 5. Persistence Plane

对应真实代码：

- `src/sessions/*`
- `docs/concepts/session.md`
- `docs/concepts/memory.md`

学习工程：

- `learn/session-memory-design`

核心问题：

- session metadata 和 transcript 为什么要分层
- memory files 为什么是长期记忆的 source of truth
- pre-compaction flush 为什么是记忆生命周期的一部分

## 推荐学习路径

### 路径 A：先打通最小闭环

1. `learn/gateway-design`
2. `learn/agent-design`

适合先掌握“请求怎么进来、怎么跑完、怎么返回”。

### 路径 B：再补齐边界

3. `learn/plugin-design`
4. `learn/channel-routing-design`
5. `learn/session-memory-design`

适合把“为什么真实 OpenClaw 会拆这么多层”彻底搞明白。

## 后续 backlog

如果这五层都熟了，下一批最值得继续扩展成学习工程的是：

- `src/auto-reply`
- `src/commands`
- `src/infra`
- `apps/*`
- `media` / `tts` / `image-generation` / `web-search`
