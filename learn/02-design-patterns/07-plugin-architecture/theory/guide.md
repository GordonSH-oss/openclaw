# 插件架构模式详解

> 通过 OpenClaw 的真实插件系统，学习如何设计可扩展、类型安全的插件架构。

## 目录

1. [什么是插件架构](#1-什么是插件架构)
2. [OpenClaw 的插件系统](#2-openclaw-的插件系统)
3. [插件注册与发现](#3-插件注册与发现)
4. [生命周期管理](#4-生命周期管理)
5. [Hook 系统设计](#5-hook-系统设计)
6. [配置验证](#6-配置验证)
7. [最佳实践](#7-最佳实践)
8. [常见陷阱](#8-常见陷阱)

---

## 1. 什么是插件架构

### 1.1 核心概念

插件架构（Plugin Architecture）是一种软件设计模式，允许在不修改核心代码的情况下扩展应用功能。

**关键特点：**
- **松耦合**：插件与核心系统独立
- **动态加载**：运行时加载/卸载插件
- **标准接口**：通过统一的 API 交互
- **隔离性**：插件之间互不影响

### 1.2 适用场景

✅ **推荐使用：**
- 需要第三方扩展的应用
- 功能模块化的系统
- 需要运行时配置的程序
- 多团队协作开发

❌ **不推荐使用：**
- 简单的单体应用
- 性能要求极高的系统
- 功能固定不变的程序

### 1.3 基础示例

```typescript
// 简单的插件接口
interface Plugin {
  name: string;
  version: string;
  init(): void;
  destroy(): void;
}

// 插件注册表
class PluginRegistry {
  private plugins = new Map<string, Plugin>();
  
  register(plugin: Plugin): void {
    this.plugins.set(plugin.name, plugin);
  }
  
  load(name: string): void {
    const plugin = this.plugins.get(name);
    plugin?.init();
  }
}
```

---

## 2. OpenClaw 的插件系统

### 2.1 系统架构

OpenClaw 的插件系统由以下部分组成：

```
┌─────────────────────────────────────┐
│         Plugin Definition           │
│  - name, version                    │
│  - config & validation              │
│  - hooks & tools                    │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│         Plugin Loader               │
│  - 动态加载 (jiti)                  │
│  - 依赖解析                         │
│  - 延迟初始化 (Proxy)               │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│         Plugin Registry             │
│  - 注册管理                         │
│  - 生命周期控制                     │
│  - Hook 执行                        │
└─────────────────────────────────────┘
```

### 2.2 核心类型定义

从 `src/plugins/types.ts` 提取的核心类型：

```typescript
// 插件定义
export type OpenClawPluginDefinition<
  TName extends string = string,
  TConfig = unknown
> = {
  name: TName;
  version: string;
  description?: string;
  
  // 配置
  config?: TConfig;
  configValidation?: PluginConfigValidation;
  
  // Hook 注册
  hooks?: {
    [H in keyof PluginHookHandlerMap]?: PluginHookHandlerMap[H];
  };
  
  // 工具注册
  tools?: OpenClawPluginToolFactory | OpenClawPluginToolFactory[];
};

// Hook 处理器映射
export type PluginHookHandlerMap = {
  "gateway:start": (ctx: GatewayStartContext) => Promise<void> | void;
  "gateway:stop": (ctx: GatewayStopContext) => Promise<void> | void;
  "agent:before": (ctx: AgentContext) => Promise<void> | void;
  "agent:after": (ctx: AgentContext) => Promise<void> | void;
  // ... 更多 hooks
};
```

### 2.3 设计亮点

**1. 类型安全的泛型设计**

```typescript
// 插件名称是字符串字面量类型
type LoggerPlugin = OpenClawPluginDefinition<"logger", LoggerConfig>;

// TypeScript 会推断出正确的类型
const logger: LoggerPlugin = {
  name: "logger", // ✅ 类型正确
  // name: "cache", // ❌ 类型错误
  version: "1.0.0",
  config: { level: "info" }
};
```

**2. Hook 映射的类型安全**

```typescript
// Hook 名称和参数类型自动匹配
hooks: {
  "gateway:start": async (ctx) => {
    // ctx 的类型自动推断为 GatewayStartContext
    console.log(ctx.config);
  }
}
```

**3. 配置验证的判别联合**

```typescript
type PluginConfigValidation =
  | { ok: true; value?: unknown }
  | { ok: false; errors: string[] };

// TypeScript 自动类型缩小
if (validation.ok) {
  console.log(validation.value); // ✅ 有 value
} else {
  console.log(validation.errors); // ✅ 有 errors
}
```

---

## 3. 插件注册与发现

### 3.1 插件加载机制

OpenClaw 使用 `jiti` 进行动态加载：

```typescript
// src/plugins/loader.ts
import { createJiti } from "jiti";

export async function loadPlugin(pluginPath: string) {
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    esmResolve: true
  });
  
  // 动态导入插件模块
  const module = await jiti.import(pluginPath);
  
  // 返回插件定义
  return module.default || module;
}
```

**为什么使用 jiti？**
- ✅ 支持 TypeScript 文件直接加载
- ✅ 支持 ESM 和 CJS 混用
- ✅ 运行时转译，无需预编译
- ✅ 缓存机制，性能优秀

### 3.2 插件注册表

```typescript
// 简化版的插件注册表
class PluginRegistry {
  private plugins = new Map<string, PluginDefinition>();
  
  async register(plugin: PluginDefinition): Promise<void> {
    // 1. 验证插件
    this.validatePlugin(plugin);
    
    // 2. 检查依赖
    await this.checkDependencies(plugin);
    
    // 3. 注册 hooks
    this.registerHooks(plugin);
    
    // 4. 注册 tools
    this.registerTools(plugin);
    
    // 5. 保存插件
    this.plugins.set(plugin.name, plugin);
    
    console.log(`✅ 插件已注册: ${plugin.name}`);
  }
  
  private validatePlugin(plugin: PluginDefinition): void {
    if (!plugin.name || !plugin.version) {
      throw new Error("插件必须有 name 和 version");
    }
    
    if (this.plugins.has(plugin.name)) {
      throw new Error(`插件 ${plugin.name} 已存在`);
    }
  }
}
```

### 3.3 插件发现

OpenClaw 支持多种插件发现方式：

**1. 内置插件目录**

```typescript
const PLUGIN_DIRS = [
  "./plugins",           // 本地插件
  "./extensions",        // 扩展插件
  "~/.openclaw/plugins"  // 用户插件
];

async function discoverPlugins(): Promise<string[]> {
  const plugins: string[] = [];
  
  for (const dir of PLUGIN_DIRS) {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file.endsWith(".ts") || file.endsWith(".js")) {
        plugins.push(path.join(dir, file));
      }
    }
  }
  
  return plugins;
}
```

**2. npm 包插件**

```typescript
// package.json
{
  "dependencies": {
    "@openclaw/plugin-memory": "^1.0.0",
    "@openclaw/plugin-search": "^1.0.0"
  }
}

// 自动加载
const npmPlugins = Object.keys(dependencies)
  .filter(name => name.startsWith("@openclaw/plugin-"));
```

**3. 配置文件指定**

```json5
// config.json5
{
  plugins: {
    enabled: ["logger", "cache", "memory"],
    paths: ["./custom-plugins"]
  }
}
```

---

## 4. 生命周期管理

### 4.1 插件生命周期

```
┌──────────┐
│  Created │ 插件模块加载
└────┬─────┘
     │
     ▼
┌──────────┐
│ Registered│ 插件注册到系统
└────┬─────┘
     │
     ▼
┌──────────┐
│ Initialized│ init() 调用
└────┬─────┘
     │
     ▼
┌──────────┐
│  Running │ 正常运行
└────┬─────┘
     │
     ▼
┌──────────┐
│ Destroyed│ destroy() 调用
└────┬─────┘
     │
     ▼
┌──────────┐
│ Unloaded │ 从系统移除
└──────────┘
```

### 4.2 生命周期 Hooks

OpenClaw 提供丰富的生命周期 hooks：

```typescript
export type PluginHookHandlerMap = {
  // 系统级
  "gateway:start": (ctx) => void;      // Gateway 启动
  "gateway:stop": (ctx) => void;       // Gateway 停止
  "config:reload": (ctx) => void;      // 配置重载
  
  // Agent 级
  "agent:before": (ctx) => void;       // Agent 执行前
  "agent:after": (ctx) => void;        // Agent 执行后
  "agent:error": (ctx) => void;        // Agent 错误
  
  // 插件级
  "plugin:load": (ctx) => void;        // 插件加载
  "plugin:unload": (ctx) => void;      // 插件卸载
};
```

### 4.3 实现示例

```typescript
const loggerPlugin: OpenClawPluginDefinition = {
  name: "logger",
  version: "1.0.0",
  
  hooks: {
    "gateway:start": async ({ config }) => {
      console.log("🚀 Gateway 启动，初始化日志系统");
      // 初始化日志写入器
      await initializeLogWriter(config.logging);
    },
    
    "agent:before": async ({ agentId, sessionId }) => {
      console.log(`📝 [${agentId}] 开始执行 (session: ${sessionId})`);
    },
    
    "agent:after": async ({ agentId, result }) => {
      console.log(`✅ [${agentId}] 执行完成`);
      // 记录执行日志
      await logAgentExecution(agentId, result);
    },
    
    "gateway:stop": async () => {
      console.log("🛑 Gateway 停止，关闭日志系统");
      // 刷新并关闭日志
      await flushAndCloseLogger();
    }
  }
};
```

---

## 5. Hook 系统设计

### 5.1 Hook 执行器

OpenClaw 的 Hook 执行器确保类型安全：

```typescript
// src/plugins/hooks.ts
export class HookExecutor {
  private hooks: {
    [H in keyof PluginHookHandlerMap]: Array<PluginHookHandlerMap[H]>;
  } = createEmptyHookMap();
  
  // 注册 Hook（类型安全）
  register<H extends keyof PluginHookHandlerMap>(
    hookName: H,
    handler: PluginHookHandlerMap[H]
  ): void {
    this.hooks[hookName].push(handler);
  }
  
  // 执行 Hook（并行）
  async executeVoid<H extends keyof PluginHookHandlerMap>(
    hookName: H,
    context: Parameters<PluginHookHandlerMap[H]>[0]
  ): Promise<void> {
    const handlers = this.hooks[hookName];
    
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
}
```

### 5.2 Hook 类型

**1. Void Hooks（无返回值）**

并行执行，不修改数据：

```typescript
// 并行执行所有处理器
await executor.executeVoid("gateway:start", { config });
```

**2. Modifying Hooks（修改数据）**

串行执行，可以修改传入的数据：

```typescript
export async function runModifyingHook<T>(
  hookName: string,
  initialValue: T,
  handlers: Array<(value: T) => T | Promise<T>>
): Promise<T> {
  let result = initialValue;
  
  // 串行执行，每个处理器可以修改结果
  for (const handler of handlers) {
    result = await handler(result);
  }
  
  return result;
}

// 使用示例
const finalConfig = await runModifyingHook(
  "config:transform",
  initialConfig,
  configTransformers
);
```

### 5.3 Hook 优先级

```typescript
type HookRegistration = {
  handler: Function;
  priority: number;  // 数字越大优先级越高
};

class HookExecutor {
  private hooks = new Map<string, HookRegistration[]>();
  
  register(hookName: string, handler: Function, priority = 0): void {
    const registrations = this.hooks.get(hookName) || [];
    registrations.push({ handler, priority });
    
    // 按优先级排序
    registrations.sort((a, b) => b.priority - a.priority);
    
    this.hooks.set(hookName, registrations);
  }
}
```

---

## 6. 配置验证

### 6.1 验证方式

OpenClaw 支持三种配置验证方式：

**1. 无验证**

```typescript
const plugin: PluginDefinition = {
  name: "simple",
  version: "1.0.0",
  config: { anything: true }
  // 不提供 configValidation
};
```

**2. Schema 验证（TypeBox/Zod）**

```typescript
import { Type } from "@sinclair/typebox";

const ConfigSchema = Type.Object({
  apiKey: Type.String(),
  timeout: Type.Number({ minimum: 0 }),
  retries: Type.Optional(Type.Number())
});

const plugin: PluginDefinition = {
  name: "api-client",
  version: "1.0.0",
  config: { apiKey: "secret", timeout: 5000 },
  configSchema: ConfigSchema
};
```

**3. 自定义验证函数**

```typescript
const plugin: PluginDefinition = {
  name: "custom",
  version: "1.0.0",
  config: { port: 3000 },
  configValidation: {
    validate: (config: unknown): PluginConfigValidation => {
      const c = config as { port: number };
      
      if (!c.port) {
        return { ok: false, errors: ["Missing port"] };
      }
      
      if (c.port < 1024 || c.port > 65535) {
        return {
          ok: false,
          errors: ["Port must be between 1024 and 65535"]
        };
      }
      
      return { ok: true, value: c };
    }
  }
};
```

### 6.2 配置热重载

OpenClaw 支持配置热重载：

```typescript
export async function reloadPluginConfig(
  pluginName: string,
  newConfig: unknown
): Promise<void> {
  const plugin = registry.get(pluginName);
  if (!plugin) return;
  
  // 1. 验证新配置
  const validation = plugin.configValidation?.validate(newConfig);
  if (validation && !validation.ok) {
    throw new Error(`配置验证失败: ${validation.errors.join(", ")}`);
  }
  
  // 2. 触发配置变更 hook
  await hookExecutor.executeVoid("config:change", {
    pluginName,
    oldConfig: plugin.config,
    newConfig
  });
  
  // 3. 更新配置
  plugin.config = newConfig;
  
  console.log(`✅ 插件 ${pluginName} 配置已更新`);
}
```

---

## 7. 最佳实践

### 7.1 插件设计原则

**1. 单一职责**

每个插件只做一件事：

```typescript
// ✅ 好：职责单一
const loggerPlugin = { name: "logger", /* ... */ };
const cachePlugin = { name: "cache", /* ... */ };

// ❌ 坏：职责混杂
const megaPlugin = {
  name: "everything",
  // 既做日志又做缓存又做监控...
};
```

**2. 最小依赖**

```typescript
// ✅ 好：依赖最小
const plugin = {
  name: "simple",
  dependencies: []
};

// ❌ 坏：过度依赖
const plugin = {
  name: "complex",
  dependencies: ["dep1", "dep2", "dep3", "dep4"]
};
```

**3. 配置优于代码**

```typescript
// ✅ 好：通过配置控制行为
const plugin = {
  name: "logger",
  config: {
    level: "info",      // 可配置
    format: "json"      // 可配置
  }
};

// ❌ 坏：硬编码
const plugin = {
  name: "logger",
  init() {
    // 硬编码的日志级别
    logger.setLevel("debug");
  }
};
```

### 7.2 错误处理

**1. Hook 中的错误处理**

```typescript
hooks: {
  "agent:before": async (ctx) => {
    try {
      await riskyOperation();
    } catch (error) {
      // 记录错误但不阻塞其他插件
      console.error("Plugin error:", error);
      // 可选：报告错误到监控系统
      await reportError(error);
    }
  }
}
```

**2. 优雅降级**

```typescript
const plugin = {
  name: "optional-feature",
  
  async init() {
    try {
      await connectToExternalService();
    } catch (error) {
      console.warn("外部服务不可用，使用备用方案");
      this.useFallback = true;
    }
  },
  
  hooks: {
    "agent:before": async (ctx) => {
      if (this.useFallback) {
        // 使用备用逻辑
        await fallbackLogic(ctx);
      } else {
        // 使用正常逻辑
        await normalLogic(ctx);
      }
    }
  }
};
```

### 7.3 性能优化

**1. 延迟初始化**

```typescript
// OpenClaw 使用 Proxy 实现延迟初始化
export function createLazyPlugin<T>(
  loader: () => T
): T {
  let instance: T | null = null;
  
  return new Proxy({} as T, {
    get(target, prop) {
      if (!instance) {
        instance = loader();
      }
      return instance[prop as keyof T];
    }
  });
}

// 使用
const heavyPlugin = createLazyPlugin(() => {
  // 只在首次访问时才加载
  return require("./heavy-plugin");
});
```

**2. Hook 去重**

```typescript
class HookExecutor {
  private executedHooks = new Set<string>();
  
  async executeOnce(hookName: string, context: unknown): Promise<void> {
    const key = `${hookName}:${JSON.stringify(context)}`;
    
    if (this.executedHooks.has(key)) {
      return; // 已执行过，跳过
    }
    
    await this.execute(hookName, context);
    this.executedHooks.add(key);
  }
}
```

---

## 8. 常见陷阱

### 8.1 循环依赖

❌ **错误示例：**

```typescript
// plugin-a.ts
export default {
  name: "plugin-a",
  dependencies: ["plugin-b"]
};

// plugin-b.ts
export default {
  name: "plugin-b",
  dependencies: ["plugin-a"]  // ❌ 循环依赖
};
```

✅ **解决方案：**

```typescript
// 1. 重新设计依赖关系
// 2. 提取共享逻辑到第三个插件
// 3. 使用事件而非直接依赖

// plugin-common.ts
export const commonLogic = { /* ... */ };

// plugin-a.ts
import { commonLogic } from "./plugin-common";
export default {
  name: "plugin-a",
  dependencies: [] // 无依赖
};
```

### 8.2 内存泄漏

❌ **错误示例：**

```typescript
const plugin = {
  name: "leaky",
  
  hooks: {
    "agent:before": (ctx) => {
      // ❌ 永久保存所有上下文
      allContexts.push(ctx);
    }
  }
};
```

✅ **解决方案：**

```typescript
const plugin = {
  name: "careful",
  
  hooks: {
    "agent:before": (ctx) => {
      // ✅ 只保存必要信息
      recentContexts.push({
        id: ctx.agentId,
        timestamp: Date.now()
      });
      
      // ✅ 定期清理
      if (recentContexts.length > 100) {
        recentContexts.shift();
      }
    }
  }
};
```

### 8.3 Hook 顺序依赖

❌ **错误示例：**

```typescript
// 插件 A 依赖插件 B 的 hook 先执行
hooks: {
  "agent:before": (ctx) => {
    // ❌ 假设 plugin-b 已经处理过 ctx
    const data = ctx.processedByPluginB;
  }
}
```

✅ **解决方案：**

```typescript
// 1. 使用优先级
register("agent:before", handlerA, { priority: 0 });
register("agent:before", handlerB, { priority: 10 }); // 先执行

// 2. 使用不同的 hook 阶段
hooks: {
  "agent:before:early": handlerB,
  "agent:before:late": handlerA
}

// 3. 显式声明依赖
{
  name: "plugin-a",
  dependencies: ["plugin-b"],
  hooks: { /* ... */ }
}
```

---

## 参考资源

### OpenClaw 源码
- `src/plugins/types.ts` - 插件类型定义
- `src/plugins/loader.ts` - 插件加载器
- `src/plugins/hooks.ts` - Hook 执行器
- `src/plugins/runtime/` - 插件运行时
- `extensions/` - 实际插件示例

### 推荐阅读
- [Martin Fowler - Plugin](https://martinfowler.com/eaaCatalog/plugin.html)
- [Micro Frontends](https://micro-frontends.org/)
- [The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)

---

**下一步：** 学习事件驱动架构 (08-event-driven)
