# Mini Session Memory Design

`learn/session-memory-design` 负责把 OpenClaw 里 session、transcript、workspace memory 这三条线组合成一个清晰的学习包。

## 两层记忆模型

- 短期记忆
  - `session-store.ts`
  - `transcript-store.ts`
- 长期记忆
  - `workspace-memory.ts`
  - `memory-index.ts`
  - `memory-flush.ts`

## 当前结构

```text
src/
  session-store.ts
  transcript-store.ts
  session-lifecycle.ts
  session-maintenance.ts
  workspace-memory.ts
  memory-index.ts
  memory-flush.ts
  events.ts
  index.ts
```

## 学习重点

- session metadata 为什么应该小而频繁更新
- transcript 为什么适合 append-only
- memory files 为什么是长期记忆的 source of truth
- flush 为什么是“把短期上下文写回长期记忆”的生命周期动作

## 推荐阅读顺序

1. `src/session-store.ts`
2. `src/transcript-store.ts`
3. `src/workspace-memory.ts`
4. `src/memory-index.ts`
5. `src/memory-flush.ts`
6. `src/session-maintenance.ts`
7. `src/events.ts`
