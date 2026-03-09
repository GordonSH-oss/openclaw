# 事件驱动架构详解

> 通过 OpenClaw 的 Hook 系统，学习事件驱动架构的设计与实现。

## 核心概念

事件驱动架构（Event-Driven Architecture, EDA）是一种以事件为中心的软件架构模式。

### 关键组件

1. **事件发布者**（Event Publisher）
2. **事件订阅者**（Event Subscriber）
3. **事件总线**（Event Bus）
4. **事件处理器**（Event Handler）

### OpenClaw 的实现

```typescript
// src/plugins/hooks.ts
export async function runVoidHook<H extends keyof PluginHookHandlerMap>(
  hookName: H,
  context: Parameters<PluginHookHandlerMap[H]>[0]
): Promise<void> {
  const handlers = hookRegistry[hookName] || [];
  
  // 并行执行所有处理器
  await Promise.all(
    handlers.map(async (handler) => {
      try {
        await handler(context);
      } catch (error) {
        console.error(`Hook ${hookName} failed:`, error);
      }
    })
  );
}
```

## 设计要点

1. **松耦合**：发布者和订阅者互不依赖
2. **可扩展**：添加新订阅者无需修改发布者
3. **异步处理**：事件可以异步处理
4. **错误隔离**：单个处理器失败不影响其他

## 最佳实践

- 事件命名要清晰（如 "agent:before"）
- 事件数据要完整但精简
- 避免事件风暴（event storm）
- 使用事件版本管理

参考：
- `src/plugins/hooks.ts`
- `src/infra/agent-events.ts`
- `src/gateway/server-broadcast.ts`
