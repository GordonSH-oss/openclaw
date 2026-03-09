# 插件架构模式 - 练习题

完成以下 5 道编程题，检验你对插件架构的理解。

## 练习 1：基础插件系统

### 难度：⭐（简单）
### 预计时间：30 分钟

### 要求

实现一个基础的插件系统，支持：
1. 插件注册
2. 插件加载/卸载
3. 生命周期管理（init/destroy）

### 代码模板

```typescript
interface Plugin {
  name: string;
  version: string;
  init(): void | Promise<void>;
  destroy(): void | Promise<void>;
}

class PluginRegistry {
  // TODO: 实现插件注册表
  register(plugin: Plugin): void {
    // 你的代码
  }
  
  async load(name: string): Promise<void> {
    // 你的代码
  }
  
  async unload(name: string): Promise<void> {
    // 你的代码
  }
  
  getAll(): Plugin[] {
    // 你的代码
  }
}
```

### 测试用例

```typescript
const logger: Plugin = {
  name: "logger",
  version: "1.0.0",
  init: () => console.log("Logger 已初始化"),
  destroy: () => console.log("Logger 已销毁")
};

const registry = new PluginRegistry();
registry.register(logger);
await registry.load("logger");  // 应该调用 init()
await registry.unload("logger"); // 应该调用 destroy()
```

---

## 练习 2：类型安全的 Hook 系统

### 难度：⭐⭐（中等）
### 预计时间：45 分钟

### 要求

实现一个类型安全的 Hook 系统，支持：
1. Hook 注册（类型安全）
2. Hook 执行（并行）
3. 错误处理

### 代码模板

```typescript
type HookMap = {
  "app:start": (ctx: { config: unknown }) => void | Promise<void>;
  "app:stop": () => void | Promise<void>;
  "data:process": (ctx: { data: string }) => void | Promise<void>;
};

class HookExecutor {
  // TODO: 实现 Hook 执行器
  register<H extends keyof HookMap>(
    hookName: H,
    handler: HookMap[H]
  ): void {
    // 你的代码
  }
  
  async execute<H extends keyof HookMap>(
    hookName: H,
    context: Parameters<HookMap[H]>[0]
  ): Promise<void> {
    // 你的代码
  }
}
```

### 提示

- 使用 `Map` 存储 hooks
- 使用 `Promise.all` 并行执行
- 使用 `try-catch` 处理错误

---

## 练习 3：插件配置验证

### 难度：⭐⭐（中等）
### 预计时间：40 分钟

### 要求

实现插件配置验证系统，支持：
1. 判别联合的验证结果
2. Schema 验证
3. 自定义验证函数

### 代码模板

```typescript
type ValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; errors: string[] };

interface PluginWithConfig {
  name: string;
  config?: unknown;
  validate?: (config: unknown) => ValidationResult;
}

async function validateAndRegister(
  plugin: PluginWithConfig
): Promise<void> {
  // TODO: 实现配置验证和注册
  // 你的代码
}
```

### 测试用例

```typescript
const validPlugin = {
  name: "valid",
  config: { port: 3000 },
  validate: (cfg: unknown) => {
    const c = cfg as { port: number };
    if (c.port < 1024) {
      return { ok: false, errors: ["Port too low"] };
    }
    return { ok: true, value: c };
  }
};

await validateAndRegister(validPlugin); // 应该成功
```

---

## 练习 4：插件依赖管理

### 难度：⭐⭐⭐（困难）
### 预计时间：60 分钟

### 要求

实现插件依赖管理系统，支持：
1. 声明依赖
2. 依赖检查
3. 按依赖顺序加载
4. 检测循环依赖

### 代码模板

```typescript
interface PluginWithDeps {
  name: string;
  dependencies?: string[];
  init(): void | Promise<void>;
}

class PluginManager {
  private plugins = new Map<string, PluginWithDeps>();
  private loaded = new Set<string>();
  
  register(plugin: PluginWithDeps): void {
    // TODO: 注册插件
  }
  
  async loadWithDeps(name: string): Promise<void> {
    // TODO: 按依赖顺序加载
    // 1. 检查是否已加载
    // 2. 检查依赖是否存在
    // 3. 检测循环依赖
    // 4. 递归加载依赖
    // 5. 加载当前插件
  }
  
  private detectCycle(
    name: string,
    visited: Set<string>,
    stack: Set<string>
  ): boolean {
    // TODO: 检测循环依赖
  }
}
```

### 提示

- 使用 DFS（深度优先搜索）检测循环依赖
- 使用拓扑排序确定加载顺序
- 记录已访问和正在访问的节点

---

## 练习 5：完整的插件系统

### 难度：⭐⭐⭐（困难）
### 预计时间：90 分钟

### 要求

结合前面所学，实现一个完整的插件系统，支持：
1. 类型安全的插件定义
2. Hook 系统
3. 配置验证
4. 依赖管理
5. 生命周期管理

### 功能需求

```typescript
type HookMap = {
  "system:init": () => void | Promise<void>;
  "system:shutdown": () => void | Promise<void>;
  "request:before": (ctx: { url: string }) => void | Promise<void>;
  "request:after": (ctx: { url: string; response: unknown }) => void | Promise<void>;
};

type PluginDefinition<TConfig = unknown> = {
  name: string;
  version: string;
  dependencies?: string[];
  config?: TConfig;
  validate?: (config: unknown) => ValidationResult;
  hooks?: {
    [H in keyof HookMap]?: HookMap[H];
  };
};

class AdvancedPluginSystem {
  // TODO: 实现完整的插件系统
  
  register(plugin: PluginDefinition): Promise<void> {
    // 1. 验证配置
    // 2. 检查依赖
    // 3. 注册 hooks
    // 4. 保存插件
  }
  
  async loadAll(): Promise<void> {
    // 按依赖顺序加载所有插件
  }
  
  async executeHook<H extends keyof HookMap>(
    hookName: H,
    context: Parameters<HookMap[H]>[0]
  ): Promise<void> {
    // 执行指定 hook
  }
  
  async shutdown(): Promise<void> {
    // 优雅关闭所有插件
  }
}
```

### 实现要求

1. **类型安全**：所有操作都有类型检查
2. **错误处理**：优雅处理各种错误情况
3. **性能优化**：避免不必要的重复操作
4. **完整测试**：编写至少 5 个测试用例

### 测试用例示例

```typescript
const loggerPlugin: PluginDefinition = {
  name: "logger",
  version: "1.0.0",
  hooks: {
    "system:init": () => console.log("系统初始化"),
    "request:before": ({ url }) => console.log(`请求: ${url}`)
  }
};

const cachePlugin: PluginDefinition = {
  name: "cache",
  version: "1.0.0",
  dependencies: ["logger"],  // 依赖 logger
  hooks: {
    "request:before": ({ url }) => {
      // 检查缓存
    }
  }
};

const system = new AdvancedPluginSystem();
await system.register(loggerPlugin);
await system.register(cachePlugin);
await system.loadAll();

// 执行 hooks
await system.executeHook("system:init", undefined);
await system.executeHook("request:before", { url: "/api/users" });

// 关闭系统
await system.shutdown();
```

---

## 评分标准

- **类型安全性** (30%)：正确使用泛型和类型约束
- **功能完整性** (30%)：实现所有要求的功能
- **错误处理** (20%)：优雅处理异常情况
- **代码质量** (20%)：清晰、可维护

## 提交要求

1. 所有代码通过 TypeScript 编译
2. 包含完整的测试用例
3. 添加必要的注释
4. 遵循最佳实践

---

**参考答案**在 [solutions/](./solutions/) 目录中，建议先尝试自己实现。
