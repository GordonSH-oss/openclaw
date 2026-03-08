# 项目：构建类型安全的插件系统

## 项目概述

本项目要求你从零开始构建一个类型安全的插件系统，类似于 OpenClaw 的插件架构，但更加简化。

### 学习目标

通过完成本项目，你将：

1. 综合运用 TypeScript 高级类型特性
2. 理解插件系统的设计模式
3. 实践类型驱动开发（TDD）
4. 掌握类型安全的 API 设计

### 预估时间

- **总计**: 3-4 小时
- **理解需求**: 30 分钟
- **实现核心功能**: 2-2.5 小时
- **测试和优化**: 30-45 分钟

---

## 功能需求

### 1. 插件定义

插件应该支持：

- 唯一的插件名称（字符串字面量类型）
- 版本号
- 插件配置（泛型）
- 插件元数据（作者、描述等）
- 生命周期 Hook

### 2. Hook 系统

支持以下 Hook：

- `onLoad`: 插件加载时调用
- `onUnload`: 插件卸载时调用
- `onConfig`: 配置更新时调用
- `beforeExecute`: 工具执行前调用
- `afterExecute`: 工具执行后调用

### 3. 插件注册表

实现一个插件注册表，支持：

- 注册插件（类型安全）
- 获取插件
- 列出所有插件
- 检查插件是否存在
- 卸载插件

### 4. 配置验证

支持多种配置验证方式：

- 无验证
- Schema 验证（使用 Zod 或 TypeBox）
- 自定义验证函数

### 5. Hook 执行器

实现 Hook 执行器，支持：

- 并行执行（void hooks）
- 串行执行（modifying hooks）
- 错误处理
- Hook 优先级

---

## 类型要求

### 核心类型定义

```typescript
// 1. Hook 处理器映射
type HookHandlerMap = {
  onLoad: (ctx: { pluginName: string }) => Promise<void> | void;
  onUnload: (ctx: { pluginName: string }) => Promise<void> | void;
  onConfig: (ctx: { config: unknown }) => Promise<void> | void;
  beforeExecute: (ctx: { tool: string; params: unknown }) => Promise<void> | void;
  afterExecute: (ctx: { tool: string; result: unknown }) => Promise<void> | void;
};

// 2. 插件定义
type PluginDefinition<TName extends string = string, TConfig = unknown> = {
  name: TName;
  version: string;
  author?: string;
  description?: string;
  config?: TConfig;
  configValidation?: ConfigValidation<TConfig>;
  hooks?: {
    [H in keyof HookHandlerMap]?: HookHandlerMap[H];
  };
};

// 3. 配置验证
type ConfigValidation<T> =
  | { type: "none" }
  | { type: "schema"; schema: Schema<T> }
  | { type: "function"; validate: (config: unknown) => ValidationResult<T> };

// 4. 验证结果
type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };
```

### 类型推断要求

- 从插件定义推断配置类型
- 从 Hook 名称推断上下文类型
- 从 Schema 推断配置类型

---

## 实现要求

### 代码结构

```
src/
├── types.ts           # 核心类型定义
├── registry.ts        # 插件注册表
├── hooks.ts           # Hook 执行器
├── validation.ts      # 配置验证
└── index.ts           # 导出
```

### 实现步骤

#### 第 1 步：类型定义（30 分钟）

在 `types.ts` 中定义所有核心类型：

```typescript
// types.ts
export type HookHandlerMap = {
  // TODO: 定义 Hook 处理器映射
};

export type PluginDefinition<TName extends string, TConfig> = {
  // TODO: 定义插件结构
};

export type ConfigValidation<T> = {
  // TODO: 定义配置验证类型（判别联合）
};
```

#### 第 2 步：插件注册表（60 分钟）

在 `registry.ts` 中实现插件注册表：

```typescript
// registry.ts
import type { PluginDefinition } from "./types.js";

export class PluginRegistry {
  private plugins = new Map<string, PluginDefinition>();

  // TODO: register - 注册插件（泛型方法）
  register<TName extends string, TConfig>(
    plugin: PluginDefinition<TName, TConfig>
  ): void {
    // 你的实现
  }

  // TODO: get - 获取插件（类型安全）
  get<TName extends string>(name: TName): PluginDefinition | undefined {
    // 你的实现
  }

  // TODO: has - 检查插件是否存在
  has(name: string): boolean {
    // 你的实现
  }

  // TODO: list - 列出所有插件
  list(): PluginDefinition[] {
    // 你的实现
  }

  // TODO: unregister - 卸载插件
  unregister(name: string): boolean {
    // 你的实现
  }
}
```

#### 第 3 步：配置验证（30 分钟）

在 `validation.ts` 中实现配置验证：

```typescript
// validation.ts
import type { ConfigValidation, ValidationResult } from "./types.js";

export async function validateConfig<T>(
  validation: ConfigValidation<T>,
  config: unknown
): Promise<ValidationResult<T>> {
  // TODO: 根据验证类型执行不同的验证逻辑
  // 提示：使用 switch 语句和判别联合
}
```

#### 第 4 步：Hook 执行器（60 分钟）

在 `hooks.ts` 中实现 Hook 执行器：

```typescript
// hooks.ts
import type { HookHandlerMap } from "./types.js";

export class HookExecutor {
  private hooks: {
    [H in keyof HookHandlerMap]: Array<HookHandlerMap[H]>;
  };

  constructor() {
    // TODO: 初始化 hooks 映射
  }

  // TODO: register - 注册 Hook 处理器（类型安全）
  register<H extends keyof HookHandlerMap>(
    hookName: H,
    handler: HookHandlerMap[H]
  ): void {
    // 你的实现
  }

  // TODO: execute - 执行 Hook（并行）
  async execute<H extends keyof HookHandlerMap>(
    hookName: H,
    context: Parameters<HookHandlerMap[H]>[0]
  ): Promise<void> {
    // 你的实现
    // 提示：使用 Promise.all
  }

  // TODO: unregister - 取消注册 Hook
  unregister<H extends keyof HookHandlerMap>(
    hookName: H,
    handler: HookHandlerMap[H]
  ): boolean {
    // 你的实现
  }
}
```

#### 第 5 步：集成（30 分钟）

在 `index.ts` 中整合所有组件：

```typescript
// index.ts
export * from "./types.js";
export * from "./registry.js";
export * from "./hooks.js";
export * from "./validation.js";

// 创建默认实例
export const registry = new PluginRegistry();
export const hookExecutor = new HookExecutor();

// 便捷函数
export function registerPlugin<TName extends string, TConfig>(
  plugin: PluginDefinition<TName, TConfig>
): void {
  // TODO: 注册插件并自动注册 hooks
}
```

---

## 测试用例

在 `tests/` 目录创建测试文件：

### test-plugin-registry.ts

```typescript
import { PluginRegistry } from "../src/registry.js";
import { assertEquals, assertExists } from "./test-utils.js";

// 测试 1：注册和获取插件
{
  const registry = new PluginRegistry();
  
  const plugin = {
    name: "test-plugin",
    version: "1.0.0",
    config: { enabled: true },
  };
  
  registry.register(plugin);
  const retrieved = registry.get("test-plugin");
  
  assertExists(retrieved);
  assertEquals(retrieved.name, "test-plugin");
}

// 测试 2：类型安全
{
  type MyConfig = { apiKey: string };
  
  const plugin = {
    name: "typed-plugin",
    version: "1.0.0",
    config: { apiKey: "secret" } as MyConfig,
  };
  
  registry.register(plugin);
  
  // 这应该是类型安全的
  const retrieved = registry.get("typed-plugin");
  if (retrieved?.config) {
    // retrieved.config 的类型应该被推断
    console.log((retrieved.config as MyConfig).apiKey);
  }
}

console.log("✅ Plugin registry tests passed");
```

### test-hooks.ts

```typescript
import { HookExecutor } from "../src/hooks.js";
import { assertEquals } from "./test-utils.js";

// 测试 1：Hook 执行
{
  const executor = new HookExecutor();
  let executed = false;
  
  executor.register("onLoad", ({ pluginName }) => {
    executed = true;
    assertEquals(pluginName, "test");
  });
  
  await executor.execute("onLoad", { pluginName: "test" });
  assertEquals(executed, true);
}

// 测试 2：多个 Hook 并行执行
{
  const executor = new HookExecutor();
  const results: number[] = [];
  
  executor.register("onLoad", async () => {
    await delay(10);
    results.push(1);
  });
  
  executor.register("onLoad", async () => {
    await delay(5);
    results.push(2);
  });
  
  await executor.execute("onLoad", { pluginName: "test" });
  
  // 因为并行执行，2 应该先完成
  assertEquals(results, [2, 1]);
}

console.log("✅ Hook executor tests passed");
```

### test-validation.ts

```typescript
import { validateConfig } from "../src/validation.js";
import { assertEquals } from "./test-utils.js";

// 测试 1：无验证
{
  const result = await validateConfig(
    { type: "none" },
    { anything: true }
  );
  
  assertEquals(result.ok, true);
}

// 测试 2：Schema 验证（如果使用 Zod）
{
  const schema = z.object({
    apiKey: z.string(),
    timeout: z.number().optional(),
  });
  
  const result = await validateConfig(
    { type: "schema", schema },
    { apiKey: "secret" }
  );
  
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.apiKey, "secret");
  }
}

// 测试 3：自定义验证函数
{
  const result = await validateConfig(
    {
      type: "function",
      validate: (config: unknown) => {
        if (typeof config === "object" && config !== null && "key" in config) {
          return { ok: true, value: config as { key: string } };
        }
        return { ok: false, errors: ["Missing key"] };
      },
    },
    { key: "value" }
  );
  
  assertEquals(result.ok, true);
}

console.log("✅ Validation tests passed");
```

---

## 运行测试

```bash
# 使用 ts-node
ts-node tests/test-plugin-registry.ts
ts-node tests/test-hooks.ts
ts-node tests/test-validation.ts

# 或使用 bun
bun run tests/test-plugin-registry.ts
bun run tests/test-hooks.ts
bun run tests/test-validation.ts

# 或使用 vitest
npm test
```

---

## 扩展挑战

完成基础功能后，尝试以下扩展：

### 挑战 1：Hook 优先级

为 Hook 添加优先级支持：

```typescript
type HookRegistration<H extends keyof HookHandlerMap> = {
  handler: HookHandlerMap[H];
  priority?: number;  // 默认 0，数字越大优先级越高
};

// 按优先级排序后执行
```

### 挑战 2：Hook 中间件

实现类似 Express 的中间件模式：

```typescript
type Middleware<H extends keyof HookHandlerMap> = (
  context: Parameters<HookHandlerMap[H]>[0],
  next: () => Promise<void>
) => Promise<void>;

// 支持中间件链
```

### 挑战 3：插件依赖

添加插件依赖管理：

```typescript
type PluginDefinition = {
  // ...
  dependencies?: Array<{ name: string; version: string }>;
};

// 检查依赖是否满足
// 按依赖顺序加载插件
```

### 挑战 4：插件沙箱

为插件创建隔离的执行环境：

```typescript
type PluginSandbox = {
  config: unknown;
  hooks: HookExecutor;
  // 限制插件只能访问指定的 API
};
```

---

## 评分标准

- **类型安全性** (30%)：
  - 所有类型定义正确
  - 类型推断工作正常
  - 无类型错误

- **功能完整性** (30%)：
  - 所有核心功能实现
  - 测试用例通过
  - 错误处理完善

- **代码质量** (25%)：
  - 代码清晰易读
  - 注释完善
  - 遵循最佳实践

- **扩展性** (15%)：
  - 架构设计合理
  - 易于扩展
  - 完成扩展挑战

---

## 提交要求

提交前确保：

1. ✅ 所有代码通过 `tsc --strict` 编译
2. ✅ 所有测试用例通过
3. ✅ 添加 README.md 说明使用方法
4. ✅ 代码有适当的注释
5. ✅ (可选) 完成至少 1 个扩展挑战

---

## 参考资源

- [OpenClaw 插件系统](../../../openclaw/src/plugins/)
- [TypeScript Handbook - Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html)
- [TypeScript Handbook - Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)

---

**祝你好运！这是一个综合性项目，会巩固你对 TypeScript 类型系统的理解。**