# TypeScript 类型系统进阶指南

> 本指南通过 OpenClaw 的真实代码示例，深入讲解 TypeScript 类型系统的高级特性。

## 目录

1. [泛型与类型推断](#1-泛型与类型推断)
2. [条件类型与 infer](#2-条件类型与-infer)
3. [联合类型与判别联合](#3-联合类型与判别联合)
4. [映射类型与工具类型](#4-映射类型与工具类型)
5. [函数重载与类型守卫](#5-函数重载与类型守卫)
6. [satisfies 与 as const](#6-satisfies-与-as-const)

---

## 1. 泛型与类型推断

### 1.1 什么是泛型？

泛型（Generics）是 TypeScript 中实现代码复用和类型安全的核心机制。它允许我们编写可以处理多种类型的代码，同时保持类型信息。

### 1.2 基础泛型示例

```typescript
// 简单的泛型函数
function identity<T>(value: T): T {
  return value;
}

// 类型推断
const num = identity(42);        // T 被推断为 number
const str = identity("hello");   // T 被推断为 string
```

### 1.3 OpenClaw 实战：从 Schema 推断类型

OpenClaw 使用 TypeBox 库定义协议 Schema，并通过泛型自动推断类型：

```typescript
// src/gateway/protocol/schema/types.ts
import { Type, type Static } from "@sinclair/typebox";

// 定义 Schema
const UserSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  age: Type.Number(),
});

// 使用 Static 泛型推断类型
type User = Static<typeof UserSchema>;
// 等价于：
// type User = {
//   id: string;
//   name: string;
//   age: number;
// }
```

**关键点：**
- `Static<T>` 是一个工具类型，能从 TypeBox Schema 推断出 TypeScript 类型
- 这避免了手动维护两套定义（Schema 和类型）
- 确保运行时验证和类型检查使用相同的定义

### 1.4 泛型约束

有时我们需要限制泛型参数的类型：

```typescript
// 约束 T 必须有 length 属性
function logLength<T extends { length: number }>(value: T): void {
  console.log(value.length);
}

logLength("hello");     // ✅ string 有 length
logLength([1, 2, 3]);   // ✅ array 有 length
logLength(42);          // ❌ number 没有 length
```

### 1.5 OpenClaw 实战：Action Gate 类型约束

```typescript
// src/agents/tools/common.ts
export type ActionGate<T extends Record<string, boolean | undefined>> = (
  key: keyof T,
  defaultValue?: boolean,
) => boolean;

// 使用示例
type ToolConfig = {
  webSearch: boolean;
  fileRead: boolean | undefined;
  codeExecution?: boolean;
};

const isActionEnabled: ActionGate<ToolConfig> = (key, defaultValue = false) => {
  // 类型安全：key 只能是 'webSearch' | 'fileRead' | 'codeExecution'
  return config[key] ?? defaultValue;
};
```

**设计亮点：**
- `T extends Record<string, boolean | undefined>` 约束了配置对象的结构
- `keyof T` 确保 key 参数只能是配置对象的键
- 这种模式在运行时提供类型安全的配置访问

### 1.6 多个泛型参数

```typescript
// OpenClaw 中的 KeyedAsyncQueue
type TaskResult<T> = Promise<T>;

function enqueueKeyedTask<T>(params: {
  tails: Map<string, Promise<void>>;
  key: string;
  task: () => Promise<T>;
}): Promise<T> {
  // T 可以是任何类型，保持灵活性
  const previous = params.tails.get(params.key) ?? Promise.resolve();
  return previous.then(params.task);
}
```

---

## 2. 条件类型与 infer

### 2.1 条件类型基础

条件类型允许我们在类型级别进行分支判断：

```typescript
type IsString<T> = T extends string ? true : false;

type A = IsString<"hello">;  // true
type B = IsString<number>;   // false
```

### 2.2 infer 关键字

`infer` 用于在条件类型中提取类型信息：

```typescript
// 提取函数的返回类型
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

function add(a: number, b: number): number {
  return a + b;
}

type AddReturn = ReturnType<typeof add>;  // number
```

### 2.3 OpenClaw 实战：函数签名提取

OpenClaw 需要支持不同版本的工具定义 API，使用条件类型来适配：

```typescript
// src/agents/pi-tool-definition-adapter.ts

// 旧版工具定义
type ToolDefinitionOld = {
  execute: (params: Record<string, unknown>) => Promise<unknown>;
};

// 新版工具定义
type ToolDefinitionNew = {
  execute: (
    params: Record<string, unknown>,
    context: ExecutionContext
  ) => Promise<unknown>;
};

// 统一的工具定义
type ToolDefinition = ToolDefinitionOld | ToolDefinitionNew;

// 使用 infer 提取参数类型
type ToolExecuteArgs = ToolDefinition["execute"] extends (...args: infer P) => unknown
  ? P
  : ToolExecuteArgsCurrent;

// 结果：ToolExecuteArgs 是参数元组类型
```

**分析：**
1. `ToolDefinition["execute"]` 获取 execute 方法的类型
2. `(...args: infer P)` 匹配函数签名并推断参数列表
3. `P` 被推断为参数元组类型

### 2.4 深层嵌套的 infer

```typescript
// 提取 Promise 的值类型
type Unwrap<T> = T extends Promise<infer U> ? U : T;

type A = Unwrap<Promise<string>>;  // string
type B = Unwrap<number>;           // number

// 递归 unwrap
type DeepUnwrap<T> = T extends Promise<infer U>
  ? DeepUnwrap<U>
  : T;

type C = DeepUnwrap<Promise<Promise<string>>>;  // string
```

### 2.5 OpenClaw 实战：插件 Hook 类型推断

```typescript
// src/plugins/types.ts
export type PluginHookHandlerMap = {
  "gateway:start": (ctx: { config: OpenClawConfig }) => Promise<void> | void;
  "agent:before": (ctx: AgentContext) => Promise<void> | void;
  "agent:after": (ctx: AgentContext) => Promise<void> | void;
};

// 推断 Hook 处理器的参数类型
type HookContext<H extends keyof PluginHookHandlerMap> = 
  PluginHookHandlerMap[H] extends (ctx: infer C) => unknown ? C : never;

// 使用
type GatewayStartContext = HookContext<"gateway:start">;
// 结果: { config: OpenClawConfig }
```

**设计优势：**
- Hook 名称和参数类型集中定义
- 添加新 Hook 时自动获得类型安全
- 插件开发者无需手动查找参数类型

---

## 3. 联合类型与判别联合

### 3.1 联合类型基础

联合类型表示值可以是多个类型之一：

```typescript
type Status = "pending" | "success" | "error";

let status: Status = "pending";  // ✅
status = "success";              // ✅
status = "unknown";              // ❌ 类型错误
```

### 3.2 判别联合（Discriminated Unions）

判别联合是一种高级模式，通过共同的"判别属性"来区分不同的类型：

```typescript
type SuccessResult = {
  status: "success";
  data: string;
};

type ErrorResult = {
  status: "error";
  error: Error;
};

type Result = SuccessResult | ErrorResult;

// TypeScript 可以通过 status 字段缩小类型
function handleResult(result: Result) {
  if (result.status === "success") {
    console.log(result.data);   // ✅ TypeScript 知道这里有 data
  } else {
    console.log(result.error);  // ✅ TypeScript 知道这里有 error
  }
}
```

### 3.3 OpenClaw 实战：插件配置验证

```typescript
// src/plugins/types.ts
type PluginConfigValidation = 
  | { type: "none" }
  | { type: "schema"; schema: TSchema }
  | { type: "function"; validate: (config: unknown) => ValidationResult };

// 类型安全的配置验证
function validatePluginConfig(validation: PluginConfigValidation, config: unknown) {
  switch (validation.type) {
    case "none":
      return { valid: true };
    
    case "schema":
      // 这里 TypeScript 知道 validation.schema 存在
      return validateAgainstSchema(validation.schema, config);
    
    case "function":
      // 这里 TypeScript 知道 validation.validate 存在
      return validation.validate(config);
  }
}
```

**设计亮点：**
- `type` 字段作为判别属性
- 每个分支都是类型安全的
- 不可能出现 `validation.schema` undefined 的情况

### 3.4 复杂判别联合

```typescript
// OpenClaw Gateway 协议的请求/响应/事件类型
type GatewayFrame =
  | { type: "request"; id: string; method: string; params: unknown }
  | { type: "response"; id: string; result?: unknown; error?: ErrorShape }
  | { type: "event"; name: string; data: unknown };

function processFrame(frame: GatewayFrame) {
  switch (frame.type) {
    case "request":
      return handleRequest(frame.id, frame.method, frame.params);
    case "response":
      return handleResponse(frame.id, frame.result, frame.error);
    case "event":
      return handleEvent(frame.name, frame.data);
  }
}
```

---

## 4. 映射类型与工具类型

### 4.1 映射类型基础

映射类型允许我们基于现有类型创建新类型：

```typescript
type Readonly<T> = {
  readonly [K in keyof T]: T[K];
};

type User = {
  name: string;
  age: number;
};

type ReadonlyUser = Readonly<User>;
// 结果:
// {
//   readonly name: string;
//   readonly age: number;
// }
```

### 4.2 常用工具类型

TypeScript 内置了许多工具类型：

```typescript
// Partial - 所有属性变为可选
type Partial<T> = {
  [K in keyof T]?: T[K];
};

// Required - 所有属性变为必需
type Required<T> = {
  [K in keyof T]-?: T[K];
};

// Pick - 选择部分属性
type Pick<T, K extends keyof T> = {
  [P in K]: T[P];
};

// Omit - 排除部分属性
type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

// Record - 创建键值对类型
type Record<K extends keyof any, T> = {
  [P in K]: T;
};
```

### 4.3 OpenClaw 实战：Hook 处理器映射

```typescript
// src/plugins/hooks.ts
import type { PluginHookHandlerMap } from "./types.ts";

// 将 Hook 处理器映射为注册表
type HookRegistry = {
  [H in keyof PluginHookHandlerMap]: Array<PluginHookHandlerMap[H]>;
};

// 运行时实现
const hookRegistry: HookRegistry = {
  "gateway:start": [],
  "agent:before": [],
  "agent:after": [],
  // ... 其他 hooks
};

// 类型安全的 Hook 注册
function registerHook<H extends keyof PluginHookHandlerMap>(
  hookName: H,
  handler: PluginHookHandlerMap[H]
): void {
  hookRegistry[hookName].push(handler);
}
```

**设计优势：**
- 从单一来源（`PluginHookHandlerMap`）派生类型
- 添加新 Hook 时自动更新所有相关类型
- 编译时保证类型安全

### 4.4 自定义工具类型

```typescript
// 深度 Readonly
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object
    ? DeepReadonly<T[K]>
    : T[K];
};

// 深度 Partial
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object
    ? DeepPartial<T[K]>
    : T[K];
};

// 提取函数类型的属性
type FunctionProperties<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never;
}[keyof T];

// 示例
type Methods = FunctionProperties<{
  name: string;
  greet: () => void;
  calculate: (x: number) => number;
}>;
// 结果: "greet" | "calculate"
```

---

## 5. 函数重载与类型守卫

### 5.1 函数重载

函数重载允许一个函数根据参数类型提供不同的类型签名：

```typescript
// 重载签名
function createElement(tag: "div"): HTMLDivElement;
function createElement(tag: "span"): HTMLSpanElement;
function createElement(tag: string): HTMLElement;

// 实现签名
function createElement(tag: string): HTMLElement {
  return document.createElement(tag);
}

// 使用时获得精确的类型
const div = createElement("div");    // HTMLDivElement
const span = createElement("span");  // HTMLSpanElement
const p = createElement("p");        // HTMLElement
```

### 5.2 OpenClaw 实战：Channel Registry

```typescript
// src/channels/registry.ts
type ChannelName = "telegram" | "discord" | "slack" | "signal";

// 重载：根据 channel 名称返回不同的配置类型
function getChannelConfig(name: "telegram"): TelegramConfig | undefined;
function getChannelConfig(name: "discord"): DiscordConfig | undefined;
function getChannelConfig(name: "slack"): SlackConfig | undefined;
function getChannelConfig(name: ChannelName): ChannelConfig | undefined;

function getChannelConfig(name: ChannelName): ChannelConfig | undefined {
  return config.channels?.[name];
}

// 使用时自动推断类型
const telegramCfg = getChannelConfig("telegram");  // TelegramConfig | undefined
```

### 5.3 类型守卫（Type Guards）

类型守卫是返回类型谓词（`is`）的函数，用于缩小类型范围：

```typescript
// 基础类型守卫
function isString(value: unknown): value is string {
  return typeof value === "string";
}

function processValue(value: string | number) {
  if (isString(value)) {
    console.log(value.toUpperCase());  // ✅ string 方法
  } else {
    console.log(value.toFixed(2));     // ✅ number 方法
  }
}
```

### 5.4 OpenClaw 实战：AbortSignal 守卫

```typescript
// src/agents/tools/common.ts
export function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    value != null &&
    typeof value === "object" &&
    "aborted" in value &&
    typeof (value as AbortSignal).aborted === "boolean"
  );
}

// 使用
function executeWithSignal(signal: unknown) {
  if (isAbortSignal(signal)) {
    if (signal.aborted) {
      throw new Error("Operation aborted");
    }
    // 这里 signal 的类型被缩小为 AbortSignal
  }
}
```

### 5.5 自定义类型谓词

```typescript
// 判断是否为 Error 对象
function isError(value: unknown): value is Error {
  return value instanceof Error;
}

// 判断对象是否有特定属性
function hasProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, unknown> {
  return typeof obj === "object" && obj !== null && key in obj;
}

// 使用
function processResponse(response: unknown) {
  if (hasProperty(response, "data") && hasProperty(response, "status")) {
    // response 被缩小为 { data: unknown; status: unknown }
    console.log(response.data, response.status);
  }
}
```

---

## 6. satisfies 与 as const

### 6.1 satisfies 操作符

`satisfies` (TypeScript 4.9+) 用于验证类型的同时保留精确的类型推断：

```typescript
type Color = "red" | "green" | "blue" | { r: number; g: number; b: number };

// 使用 as：丢失精确类型
const color1: Color = "red";
// color1 的类型是 Color，而不是 "red"

// 使用 satisfies：保留精确类型
const color2 = "red" satisfies Color;
// color2 的类型是 "red"

// 对象示例
const colors = {
  primary: "red",
  secondary: { r: 0, g: 255, b: 0 },
} satisfies Record<string, Color>;

// colors.primary 的类型是 "red"，不是 Color
// colors.secondary 的类型是 { r: number; g: number; b: number }
```

### 6.2 OpenClaw 实战：Channel Metadata

```typescript
// src/channels/registry.ts
const CHAT_CHANNEL_META = {
  telegram: {
    emoji: "📱",
    name: "Telegram",
    requiresAuth: true,
  },
  discord: {
    emoji: "🎮",
    name: "Discord",
    requiresAuth: true,
  },
  slack: {
    emoji: "💼",
    name: "Slack",
    requiresAuth: true,
  },
} satisfies Record<string, {
  emoji: string;
  name: string;
  requiresAuth: boolean;
}>;

// 类型推断保留了字面量类型
type TelegramMeta = typeof CHAT_CHANNEL_META.telegram;
// { emoji: "📱"; name: "Telegram"; requiresAuth: true }
```

**对比 as 的区别：**
```typescript
// 使用 as
const meta1 = {
  telegram: { emoji: "📱", name: "Telegram" },
} as Record<string, { emoji: string; name: string }>;

meta1.telegram.emoji;  // 类型: string

// 使用 satisfies
const meta2 = {
  telegram: { emoji: "📱", name: "Telegram" },
} satisfies Record<string, { emoji: string; name: string }>;

meta2.telegram.emoji;  // 类型: "📱"
```

### 6.3 as const 断言

`as const` 将类型推断为最窄的字面量类型：

```typescript
// 不使用 as const
const colors1 = ["red", "green", "blue"];
// 类型: string[]

// 使用 as const
const colors2 = ["red", "green", "blue"] as const;
// 类型: readonly ["red", "green", "blue"]

// 对象
const config1 = {
  port: 3000,
  host: "localhost",
};
// 类型: { port: number; host: string }

const config2 = {
  port: 3000,
  host: "localhost",
} as const;
// 类型: { readonly port: 3000; readonly host: "localhost" }
```

### 6.4 OpenClaw 实战：Channel 顺序

```typescript
// src/channels/registry.ts
const CHAT_CHANNEL_ORDER = [
  "telegram",
  "discord",
  "slack",
  "signal",
  "web",
] as const;

// 类型推断
type ChannelName = (typeof CHAT_CHANNEL_ORDER)[number];
// 结果: "telegram" | "discord" | "slack" | "signal" | "web"

// 如果不用 as const
const ORDER_WITHOUT_CONST = ["telegram", "discord"];
type Name = (typeof ORDER_WITHOUT_CONST)[number];
// 结果: string  (太宽泛！)
```

**使用场景：**
- 定义常量数组并从中派生联合类型
- 确保对象属性不被修改
- 保留字面量类型以获得更好的类型检查

### 6.5 组合使用 satisfies 和 as const

```typescript
// 最佳实践：结合两者的优势
const ERROR_MESSAGES = {
  NOT_FOUND: "Resource not found",
  UNAUTHORIZED: "Unauthorized access",
  SERVER_ERROR: "Internal server error",
} as const satisfies Record<string, string>;

// ERROR_MESSAGES 是 readonly 的
// 每个值都是字面量类型
type ErrorCode = keyof typeof ERROR_MESSAGES;
// "NOT_FOUND" | "UNAUTHORIZED" | "SERVER_ERROR"

type ErrorMessage = (typeof ERROR_MESSAGES)[ErrorCode];
// "Resource not found" | "Unauthorized access" | "Internal server error"
```

---

## 7. 实战案例：完整的插件类型系统

将所有知识点整合，看看 OpenClaw 如何构建类型安全的插件系统：

```typescript
// 1. 定义 Hook 映射（判别联合 + 映射类型）
export type PluginHookHandlerMap = {
  "gateway:start": (ctx: { config: OpenClawConfig }) => Promise<void> | void;
  "agent:before": (ctx: AgentContext) => Promise<void> | void;
  "agent:after": (ctx: AgentContext) => Promise<void> | void;
};

// 2. 插件定义（泛型 + 条件类型）
export type OpenClawPluginDefinition<
  TName extends string = string,
  TConfig = unknown
> = {
  name: TName;
  version: string;
  
  // 配置验证（判别联合）
  configValidation?: PluginConfigValidation;
  
  // Hook 注册（映射类型）
  hooks?: {
    [H in keyof PluginHookHandlerMap]?: PluginHookHandlerMap[H];
  };
  
  // 初始化函数（泛型约束）
  init?: (config: TConfig) => Promise<void> | void;
};

// 3. 插件加载器（条件类型 + infer）
type ExtractPluginConfig<P> = P extends OpenClawPluginDefinition<string, infer C>
  ? C
  : never;

// 4. 类型安全的 Hook 执行（函数重载 + 类型守卫）
export async function runHook<H extends keyof PluginHookHandlerMap>(
  hookName: H,
  context: Parameters<PluginHookHandlerMap[H]>[0]
): Promise<void> {
  const handlers = hookRegistry[hookName];
  
  await Promise.all(
    handlers.map(async (handler) => {
      try {
        await handler(context);
      } catch (error) {
        if (isError(error)) {
          log.error(`Hook ${hookName} failed:`, error.message);
        }
      }
    })
  );
}

// 5. 插件 API（工具类型 + satisfies）
export const pluginApi = {
  registerHook: <H extends keyof PluginHookHandlerMap>(
    name: H,
    handler: PluginHookHandlerMap[H]
  ) => void,
  
  getConfig: <T = unknown>() => T,
  
  log: {
    info: (msg: string) => void,
    error: (msg: string) => void,
  },
} as const satisfies Record<string, unknown>;
```

**类型系统设计要点：**

1. **中心化类型定义**：`PluginHookHandlerMap` 作为单一数据源
2. **类型推断**：使用 `infer` 和 `Parameters` 自动提取类型
3. **类型安全**：编译时保证 hook 名称和参数匹配
4. **可扩展性**：添加新 hook 时自动更新所有相关类型
5. **运行时安全**：结合类型守卫进行运行时验证

---

## 8. 最佳实践总结

### 8.1 何时使用泛型

✅ **推荐使用：**
- 编写通用数据结构（队列、栈、树）
- 工具函数需要保留类型信息
- API 设计需要类型安全和灵活性

❌ **避免使用：**
- 只在一个地方使用的函数
- 类型过于复杂导致可读性下降
- 可以用更简单的方式实现

### 8.2 条件类型使用场景

- 类型转换和提取
- 实现工具类型
- 根据输入类型决定输出类型
- 库的 API 设计

### 8.3 判别联合最佳实践

1. **选择好的判别属性**：通常是 `type` 或 `kind`
2. **使用字面量类型**：`"success"` 而不是 `string`
3. **保持一致性**：所有分支都有相同的判别属性
4. **结合 switch**：利用 TypeScript 的穷尽性检查

### 8.4 类型守卫技巧

```typescript
// ✅ 好的类型守卫：具体且可靠
function isUser(value: unknown): value is User {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    typeof (value as User).id === "string" &&
    typeof (value as User).name === "string"
  );
}

// ❌ 差的类型守卫：过于宽松
function isUser(value: unknown): value is User {
  return value !== null;  // 几乎任何东西都能通过
}
```

### 8.5 何时使用 satisfies vs as

| 场景 | 使用 |
|------|------|
| 需要验证类型但保留精确推断 | `satisfies` |
| 类型断言（确定但 TS 不知道） | `as` |
| 定义常量配置 | `satisfies` + `as const` |
| 类型转换（如 unknown → 具体类型） | `as` (with caution) |

---

## 9. 常见陷阱与解决方案

### 9.1 过度使用 any

```typescript
// ❌ 破坏类型安全
function process(data: any) {
  return data.value;  // 没有类型检查
}

// ✅ 使用泛型或 unknown
function process<T>(data: T): T {
  return data;
}

function process(data: unknown) {
  if (hasProperty(data, "value")) {
    return data.value;
  }
}
```

### 9.2 循环依赖

```typescript
// ❌ 循环引用导致无限递归
type A = B extends string ? string : number;
type B = A extends number ? number : string;

// ✅ 添加终止条件
type DeepReadonly<T, Depth extends number = 5> =
  Depth extends 0
    ? T
    : {
        readonly [K in keyof T]: T[K] extends object
          ? DeepReadonly<T[K], Decrement<Depth>>
          : T[K];
      };
```

### 9.3 类型推断失败

```typescript
// ❌ TypeScript 无法推断
const items = [];  // any[]
items.push("hello");

// ✅ 显式类型注解
const items: string[] = [];
items.push("hello");

// ✅ 初始化时提供值
const items = ["hello"];  // string[]
```

---

## 10. 进阶练习

### 练习 1：实现 DeepPartial

编写一个 `DeepPartial<T>` 类型，将对象的所有嵌套属性变为可选：

```typescript
type DeepPartial<T> = /* 你的实现 */;

type User = {
  name: string;
  address: {
    street: string;
    city: string;
  };
};

type PartialUser = DeepPartial<User>;
// 应该是:
// {
//   name?: string;
//   address?: {
//     street?: string;
//     city?: string;
//   };
// }
```

### 练习 2：类型安全的事件发射器

实现一个类型安全的事件发射器：

```typescript
type Events = {
  login: { userId: string };
  logout: { userId: string; reason: string };
  error: { code: number; message: string };
};

class EventEmitter<E extends Record<string, unknown>> {
  on<K extends keyof E>(event: K, handler: (data: E[K]) => void): void {
    // 实现
  }
  
  emit<K extends keyof E>(event: K, data: E[K]): void {
    // 实现
  }
}

// 使用
const emitter = new EventEmitter<Events>();
emitter.on("login", (data) => {
  // data 的类型应该是 { userId: string }
  console.log(data.userId);
});
```

### 练习 3：条件类型工具

实现一个 `PromiseValue<T>` 类型，提取 Promise 的值类型：

```typescript
type PromiseValue<T> = /* 你的实现 */;

type A = PromiseValue<Promise<string>>;  // string
type B = PromiseValue<Promise<number>>;  // number
type C = PromiseValue<string>;           // string
```

---

## 11. 下一步学习

完成本主题后，你应该：

1. ✅ 理解泛型的核心概念和使用场景
2. ✅ 掌握条件类型和 `infer` 的实战应用
3. ✅ 能够设计判别联合类型
4. ✅ 熟练使用映射类型和工具类型
5. ✅ 编写类型安全的类型守卫
6. ✅ 正确使用 `satisfies` 和 `as const`

**推荐继续学习：**
- [主题 02：异步编程模式](../../02-async-patterns/theory/guide.md)
- [主题 05：Schema 验证](../../05-schema-validation/theory/guide.md)
- [主题 09：依赖注入](../../../02-design-patterns/09-factory-di/theory/guide.md)

---

## 参考资源

### 官方文档
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [TypeScript Deep Dive](https://basarat.gitbook.io/typescript/)

### 推荐阅读
- [Effective TypeScript](https://effectivetypescript.com/) - 62 条最佳实践
- [Type Challenges](https://github.com/type-challenges/type-challenges) - 类型编程练习

### OpenClaw 源码
- `src/plugins/types.ts` - 完整的插件类型系统
- `src/gateway/protocol/schema/types.ts` - Schema 类型推断
- `src/agents/tools/common.ts` - 实用类型守卫

---

**学习愉快！记住：类型系统的掌握需要实践。**