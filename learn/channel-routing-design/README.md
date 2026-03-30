# Mini Channel Routing Design

`learn/channel-routing-design` 负责把 OpenClaw 里 `src/channels` 和 `src/routing` 最值得学的边界抽出来：消息是怎么被标准化、路由、隔离成不同 session 的。

## 当前结构

```text
src/
  inbound-context.ts
  bindings.ts
  route-resolver.ts
  session-key.ts
  channel-policy.ts
  account-lookup.ts
  mock-channels.ts
  index.ts
```

## 学习重点

- route 决定的是 agent 和 session 归属，不是模型行为
- channel 负责把 transport 差异折叠成统一 inbound context
- session key 是上下文隔离和并发控制的基础
- allow-from 和 mention gating 属于 channel policy，不应该散落到 agent 里

## 推荐阅读顺序

1. `src/inbound-context.ts`
2. `src/channel-policy.ts`
3. `src/session-key.ts`
4. `src/bindings.ts`
5. `src/route-resolver.ts`
6. `src/mock-channels.ts`
