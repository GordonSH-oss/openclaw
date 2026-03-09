# 工厂模式与依赖注入详解

> 学习如何使用工厂模式和依赖注入创建灵活的对象创建机制。

## 工厂模式

### 简单工厂

```typescript
class UserFactory {
  static create(type: "admin" | "user"): User {
    if (type === "admin") {
      return new AdminUser();
    }
    return new RegularUser();
  }
}
```

### 抽象工厂（OpenClaw 风格）

```typescript
// src/context-engine/registry.ts
export const contextEngineRegistry = new Map<string, ContextEngineFactory>();

export function registerContextEngine(
  name: string,
  factory: ContextEngineFactory
): void {
  contextEngineRegistry.set(name, factory);
}

export function createContextEngine(
  type: string,
  config: unknown
): ContextEngine {
  const factory = contextEngineRegistry.get(type);
  if (!factory) {
    throw new Error(`Unknown context engine: ${type}`);
  }
  return factory(config);
}
```

## 依赖注入

### 构造函数注入

```typescript
class UserService {
  constructor(
    private database: Database,
    private logger: Logger
  ) {}
  
  async getUser(id: string): Promise<User> {
    this.logger.info(`Getting user ${id}`);
    return this.database.findUser(id);
  }
}
```

### OpenClaw 的依赖注入

```typescript
// src/plugins/runtime/index.ts
export function createPluginRuntime(
  plugin: PluginDefinition,
  deps: PluginDependencies
): PluginRuntime {
  return {
    config: deps.config,
    logger: deps.logger,
    hooks: deps.hookExecutor,
    // ... 注入其他依赖
  };
}
```

## 设计要点

1. **单一职责**：工厂只负责创建对象
2. **依赖倒置**：依赖抽象而非具体实现
3. **控制反转**：由容器管理依赖关系
4. **生命周期管理**：单例 vs 瞬态

参考：
- `src/context-engine/registry.ts`
- `src/plugins/runtime/index.ts`
