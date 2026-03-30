# OpenClaw `src/channels` + `src/routing` 深读报告

## 1. 模块定位

`src/channels` 和 `src/routing` 一起承担的是 OpenClaw 的“消息入口标准化 + agent 路由”职责。

它们解决的问题不是模型怎么回答，而是：

- 这条消息来自哪个 transport
- 这条消息在系统内部应该被标准化成什么上下文
- 最终应该交给哪个 agent
- 应该进入哪个 session key

这层如果理解错了，后面的 session、agent、reply pipeline 都会跟着混乱。

## 2. 为什么这层值得单独学

很多人第一次看 OpenClaw 会把注意力全放在 Gateway 或 Agent 上，但实际运行里，routing 是一个独立的一等问题：

- 同一个 agent 可能接很多 channel
- 同一个 channel 可能有很多 account
- 同一个 account 里既有 direct chat 也有 group / room / thread
- 不同的 DM scope 会直接改变 session 隔离语义

所以 routing 不是“一个小工具函数”，而是控制上下文隔离和并发控制的核心层。

## 3. 关键文件

最值得先读：

- `src/routing/resolve-route.ts`
- `src/routing/session-key.ts`
- `src/routing/bindings.ts`
- `src/routing/account-lookup.ts`
- `src/channels/registry.ts`
- `src/channels/session.ts`
- `src/channels/channel-config.ts`
- `src/channels/allow-from.ts`

配套概念文档：

- `docs/channels/channel-routing.md`
- `docs/concepts/session.md`

## 4. 设计特征

### 4.1 channel 先做标准化，再交给 routing

channel 层不应该把自己的 transport 差异直接泄漏给后面的 agent/gateway。它更像适配器：

- 把 Telegram / Discord / Slack / WebChat 的入站差异折叠成统一上下文

### 4.2 route 决定 agentId 和 sessionKey

route 不是决定模型配置，而是决定：

- 哪个 agent 负责
- 该 agent 的哪个 session 接收上下文

### 4.3 session key 是并发和上下文隔离的基础

`main`、`per-peer`、`per-channel-peer`、`per-account-channel-peer` 这些模式，本质上都是在定义“哪些消息共享同一个上下文桶”。

### 4.4 allow-from / mention gating 属于 channel policy

这些规则不应该散落到 agent runtime 里。它们属于消息入口控制逻辑。

## 5. 推荐阅读顺序

1. `docs/channels/channel-routing.md`
2. `src/routing/session-key.ts`
3. `src/routing/resolve-route.ts`
4. `src/routing/account-lookup.ts`
5. `src/channels/allow-from.ts`
6. `src/channels/channel-config.ts`
7. `src/channels/registry.ts`

## 6. 与 `learn/channel-routing-design` 的映射

学习版把这层单独做成 `learn/channel-routing-design`，映射关系如下：

- `inbound-context.ts`
  - 对应 channel 标准化上下文的角色
  - 学习版保留“先标准化，再路由”的主线。
- `bindings.ts`
  - 对应 `src/routing/bindings.ts`
  - 学习版保留 binding 规则形状和匹配语义。
- `route-resolver.ts`
  - 对应 `src/routing/resolve-route.ts`
  - 学习版保留 `peer > parent peer > account > channel > default` 的优先级。
- `session-key.ts`
  - 对应 `src/routing/session-key.ts`
  - 学习版保留几种 DM scope 对 session key 的影响。
- `channel-policy.ts`
  - 对应 `src/channels/allow-from.ts` 等入口策略面
  - 学习版保留 allow-from 和 mention gating。
- `mock-channels.ts`
  - 对应真实系统里不同 channel adapter 的“入站折叠”职责。

学习版刻意不接真实平台 SDK，但保留了最重要的认知点：route 和 session isolation 是独立于 agent 执行的架构问题。
