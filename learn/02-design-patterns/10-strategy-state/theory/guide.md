# 策略模式与状态机详解

> 学习如何使用策略模式和状态机处理可变行为。

## 策略模式

### 基础概念

策略模式定义一系列算法，将每个算法封装起来，使它们可以互相替换。

### OpenClaw 的重试策略

```typescript
// src/infra/backoff.ts
export type BackoffPolicy = "none" | "linear" | "exponential" | "fibonacci";

export function computeBackoff(
  attempt: number,
  policy: BackoffPolicy,
  baseDelay: number
): number {
  switch (policy) {
    case "none":
      return 0;
    case "linear":
      return baseDelay * attempt;
    case "exponential":
      return baseDelay * Math.pow(2, attempt - 1);
    case "fibonacci":
      return baseDelay * fibonacci(attempt);
  }
}
```

### Channel 配置策略

```typescript
// src/channels/registry.ts
const CHAT_CHANNEL_META = {
  telegram: {
    emoji: "📱",
    requiresAuth: true,
    supportsMedia: true
  },
  discord: {
    emoji: "🎮",
    requiresAuth: true,
    supportsMedia: true
  },
  // ... 每个渠道有不同的策略
} as const;
```

## 状态机

### 基础状态机

```typescript
type State = "idle" | "processing" | "completed" | "error";

class StateMachine {
  private state: State = "idle";
  
  transition(newState: State): void {
    console.log(`${this.state} -> ${newState}`);
    this.state = newState;
  }
  
  getState(): State {
    return this.state;
  }
}
```

## 设计要点

1. **策略可替换**：运行时切换策略
2. **状态清晰**：明确定义所有可能的状态
3. **转换规则**：定义状态转换条件
4. **错误处理**：处理非法状态转换

参考：
- `src/infra/backoff.ts`
- `src/channels/registry.ts`
- `src/gateway/auth.ts`
