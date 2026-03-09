#!/usr/bin/env node
/**
 * 生成完整的简化示例代码
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(__dirname, "../learn/01-typescript-advanced/01-type-system/examples/simplified");

const examples = [
  // 已经创建的前3个
  { file: "01-basic-generics.ts", status: "created" },
  { file: "02-generic-constraints.ts", status: "created" },
  { file: "03-type-inference.ts", status: "created" },
  
  // 待创建的
  {
    file: "04-conditional-types.ts",
    content: `/**
 * 04 - 条件类型（Conditional Types）
 * 学习目标：理解 T extends U ? X : Y 语法
 */

// 基础条件类型
type IsString<T> = T extends string ? true : false;

type A = IsString<"hello">;  // true
type B = IsString<number>;   // false

console.log("✅ 条件类型基础");

// 实用例子：NonNullable
type MyNonNullable<T> = T extends null | undefined ? never : T;

type C = MyNonNullable<string | null>;  // string
type D = MyNonNullable<number | undefined>;  // number

// 练习：实现 Exclude 工具类型
type MyExclude<T, U> = T extends U ? never : T;
type E = MyExclude<"a" | "b" | "c", "a">;  // "b" | "c"

console.log("✅ 条件类型练习完成");
`
  },
  {
    file: "05-infer-keyword.ts",
    content: `/**
 * 05 - infer 关键字
 * 学习目标：使用 infer 提取类型
 */

// 提取函数返回类型
type MyReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

function add(a: number, b: number): number {
  return a + b;
}

type AddReturn = MyReturnType<typeof add>;  // number

// 提取数组元素类型
type ArrayElement<T> = T extends (infer E)[] ? E : never;

type Nums = ArrayElement<number[]>;  // number
type Strs = ArrayElement<string[]>;  // string

// 提取 Promise 值类型
type Unwrap<T> = T extends Promise<infer U> ? U : T;

type X = Unwrap<Promise<string>>;  // string
type Y = Unwrap<number>;  // number

console.log("✅ infer 关键字练习完成");
`
  },
  {
    file: "06-advanced-conditional.ts",
    content: `/**
 * 06 - 高级条件类型
 * 学习目标：复杂的条件类型应用
 */

// 分布式条件类型
type ToArray<T> = T extends any ? T[] : never;
type StrOrNumArray = ToArray<string | number>;  // string[] | number[]

// 递归条件类型
type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

type User = {
  name: string;
  address: {
    city: string;
  };
};

type ReadonlyUser = DeepReadonly<User>;
// {
//   readonly name: string;
//   readonly address: {
//     readonly city: string;
//   };
// }

console.log("✅ 高级条件类型完成");
`
  },
  {
    file: "07-union-types.ts",
    content: `/**
 * 07 - 联合类型（Union Types）
 * 学习目标：理解联合类型的使用
 */

// 基础联合类型
type Status = "pending" | "success" | "error";

let status: Status = "pending";
status = "success";  // ✅
// status = "unknown";  // ❌

// 联合类型的类型缩小
function handle(value: string | number) {
  if (typeof value === "string") {
    return value.toUpperCase();
  }
  return value.toFixed(2);
}

console.log("✅ 联合类型:", handle("hello"), handle(42));

// 数组联合
type StringOrNumber = string[] | number[];
const arr1: StringOrNumber = ["a", "b"];
const arr2: StringOrNumber = [1, 2];

console.log("✅ 数组联合:", arr1, arr2);
`
  },
  {
    file: "08-discriminated-unions.ts",
    content: `/**
 * 08 - 判别联合（Discriminated Unions）
 * 学习目标：使用判别属性进行类型安全的模式匹配
 */

// 定义判别联合
type Success = {
  type: "success";
  data: string;
};

type Error = {
  type: "error";
  error: Error;
};

type Result = Success | Error;

// 类型安全的处理
function handleResult(result: Result) {
  switch (result.type) {
    case "success":
      console.log("✅ 成功:", result.data);
      break;
    case "error":
      console.log("❌ 错误:", result.error.message);
      break;
  }
}

// 测试
handleResult({ type: "success", data: "Hello" });
handleResult({ type: "error", error: new Error("Oops") });

console.log("✅ 判别联合完成");
`
  },
  {
    file: "09-mapped-types.ts",
    content: `/**
 * 09 - 映射类型（Mapped Types）
 * 学习目标：使用映射类型转换对象类型
 */

// 基础映射类型
type Readonly<T> = {
  readonly [K in keyof T]: T[K];
};

type User = {
  name: string;
  age: number;
};

type ReadonlyUser = Readonly<User>;
// {
//   readonly name: string;
//   readonly age: number;
// }

// Partial：所有属性可选
type MyPartial<T> = {
  [K in keyof T]?: T[K];
};

type PartialUser = MyPartial<User>;
// {
//   name?: string;
//   age?: number;
// }

// Record：创建键值对类型
type MyRecord<K extends keyof any, T> = {
  [P in K]: T;
};

type UserRoles = MyRecord<"admin" | "user" | "guest", boolean>;
// {
//   admin: boolean;
//   user: boolean;
//   guest: boolean;
// }

console.log("✅ 映射类型完成");
`
  },
  {
    file: "10-type-guards.ts",
    content: `/**
 * 10 - 类型守卫（Type Guards）
 * 学习目标：实现运行时类型检查
 */

// 基础类型守卫
function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

// 使用类型守卫
function process(value: unknown) {
  if (isString(value)) {
    console.log("字符串:", value.toUpperCase());
  } else if (isNumber(value)) {
    console.log("数字:", value.toFixed(2));
  }
}

process("hello");
process(42);

// 自定义类型守卫
interface User {
  id: number;
  name: string;
}

function isUser(value: unknown): value is User {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    typeof (value as User).id === "number" &&
    typeof (value as User).name === "string"
  );
}

const data: unknown = { id: 1, name: "Alice" };

if (isUser(data)) {
  console.log("✅ 用户:", data.name);
}

console.log("✅ 类型守卫完成");
`
  },
  {
    file: "11-satisfies-const.ts",
    content: `/**
 * 11 - satisfies 与 as const
 * 学习目标：掌握精确类型推断
 */

// as const：获取字面量类型
const colors1 = ["red", "green", "blue"];
// 类型: string[]

const colors2 = ["red", "green", "blue"] as const;
// 类型: readonly ["red", "green", "blue"]

type Color = (typeof colors2)[number];  // "red" | "green" | "blue"

console.log("✅ as const 基础");

// satisfies：验证类型 + 保留精确推断
type RGB = { r: number; g: number; b: number };
type ColorValue = string | RGB;

const palette = {
  red: "ff0000",
  green: { r: 0, g: 255, b: 0 },
  blue: { r: 0, g: 0, b: 255 }
} satisfies Record<string, ColorValue>;

// palette.red 的类型是 "ff0000"，不是 ColorValue
// palette.green 的类型是 { r: number; g: number; b: number }

console.log("✅ satisfies 用法:", palette.red);

// 组合使用
const config = {
  port: 3000,
  host: "localhost"
} as const satisfies Record<string, string | number>;

// config.port 是 3000，不是 number
// config.host 是 "localhost"，不是 string

console.log("✅ satisfies + as const:", config.port);
`
  },
  {
    file: "12-utility-types.ts",
    content: `/**
 * 12 - 工具类型（Utility Types）
 * 学习目标：掌握 TypeScript 内置工具类型
 */

type User = {
  id: number;
  name: string;
  email: string;
  age: number;
};

// Partial：所有属性可选
type PartialUser = Partial<User>;

// Required：所有属性必需
type RequiredUser = Required<PartialUser>;

// Pick：选择部分属性
type UserPreview = Pick<User, "id" | "name">;

// Omit：排除部分属性
type UserWithoutEmail = Omit<User, "email">;

// Record：创建键值对
type UserMap = Record<number, User>;

// Exclude：从联合类型中排除
type StatusWithoutError = Exclude<"pending" | "success" | "error", "error">;

// Extract：从联合类型中提取
type OnlyError = Extract<"pending" | "success" | "error", "error">;

// NonNullable：排除 null 和 undefined
type NonNull = NonNullable<string | null | undefined>;

// Parameters：提取函数参数
function greet(name: string, age: number) {
  return \`Hello, \${name}! You are \${age} years old.\`;
}
type GreetParams = Parameters<typeof greet>;  // [string, number]

// ReturnType：提取函数返回类型
type GreetReturn = ReturnType<typeof greet>;  // string

console.log("✅ 工具类型完成");
`
  },
  {
    file: "13-plugin-system-simple.ts",
    content: `/**
 * 13 - 简化插件系统（第1版）
 * 学习目标：构建基础的类型安全插件系统
 */

// 简单的插件定义
type Plugin = {
  name: string;
  version: string;
  init: () => void;
};

// 插件注册表
class PluginRegistry {
  private plugins = new Map<string, Plugin>();

  register(plugin: Plugin): void {
    console.log(\`注册插件: \${plugin.name} v\${plugin.version}\`);
    this.plugins.set(plugin.name, plugin);
  }

  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  getAll(): Plugin[] {
    return Array.from(this.plugins.values());
  }
}

// 创建插件
const loggerPlugin: Plugin = {
  name: "logger",
  version: "1.0.0",
  init: () => {
    console.log("✅ Logger 插件已初始化");
  }
};

const cachePlugin: Plugin = {
  name: "cache",
  version: "1.0.0",
  init: () => {
    console.log("✅ Cache 插件已初始化");
  }
};

// 使用
const registry = new PluginRegistry();
registry.register(loggerPlugin);
registry.register(cachePlugin);

// 初始化所有插件
registry.getAll().forEach(plugin => plugin.init());

console.log("\\n✅ 简化插件系统（第1版）完成");
`
  },
  {
    file: "14-plugin-system-advanced.ts",
    content: `/**
 * 14 - 改进版插件系统（第2版）
 * 学习目标：添加泛型配置和 Hook 支持
 */

// Hook 类型定义
type HookMap = {
  "init": () => void;
  "destroy": () => void;
};

// 泛型插件定义
type Plugin<TConfig = unknown> = {
  name: string;
  version: string;
  config?: TConfig;
  hooks?: {
    [H in keyof HookMap]?: HookMap[H];
  };
};

// 类型安全的注册表
class PluginRegistry<T extends Plugin = Plugin> {
  private plugins = new Map<string, T>();

  register(plugin: T): void {
    console.log(\`注册插件: \${plugin.name} v\${plugin.version}\`);
    this.plugins.set(plugin.name, plugin);
  }

  get<P extends T>(name: string): P | undefined {
    return this.plugins.get(name) as P | undefined;
  }

  // 执行 Hook
  async runHook<H extends keyof HookMap>(hookName: H): Promise<void> {
    console.log(\`\\n执行 Hook: \${hookName}\`);
    for (const plugin of this.plugins.values()) {
      const handler = plugin.hooks?.[hookName];
      if (handler) {
        await handler();
      }
    }
  }
}

// 使用泛型配置
type LoggerConfig = {
  level: "debug" | "info" | "warn" | "error";
};

const loggerPlugin: Plugin<LoggerConfig> = {
  name: "logger",
  version: "2.0.0",
  config: { level: "info" },
  hooks: {
    init: () => console.log("✅ Logger 初始化"),
    destroy: () => console.log("✅ Logger 销毁")
  }
};

type CacheConfig = {
  ttl: number;
};

const cachePlugin: Plugin<CacheConfig> = {
  name: "cache",
  version: "2.0.0",
  config: { ttl: 3600 },
  hooks: {
    init: () => console.log("✅ Cache 初始化"),
    destroy: () => console.log("✅ Cache 销毁")
  }
};

// 使用
const registry = new PluginRegistry();
registry.register(loggerPlugin);
registry.register(cachePlugin);

await registry.runHook("init");
await registry.runHook("destroy");

console.log("\\n✅ 改进版插件系统（第2版）完成");
`
  },
  {
    file: "15-plugin-system-complete.ts",
    content: `/**
 * 15 - 完整插件系统（第3版）
 * 学习目标：实现接近生产级的类型安全插件系统
 */

// Hook 处理器映射
type HookHandlerMap = {
  "plugin:load": (ctx: { name: string }) => Promise<void> | void;
  "plugin:unload": (ctx: { name: string }) => Promise<void> | void;
  "config:change": (ctx: { config: unknown }) => Promise<void> | void;
};

// 配置验证
type ConfigValidation =
  | { type: "none" }
  | { type: "function"; validate: (config: unknown) => boolean };

// 完整的插件定义
type PluginDefinition<TName extends string = string, TConfig = unknown> = {
  name: TName;
  version: string;
  description?: string;
  config?: TConfig;
  configValidation?: ConfigValidation;
  hooks?: {
    [H in keyof HookHandlerMap]?: HookHandlerMap[H];
  };
};

// Hook 执行器
class HookExecutor {
  private hooks: {
    [H in keyof HookHandlerMap]: Array<HookHandlerMap[H]>;
  } = {
    "plugin:load": [],
    "plugin:unload": [],
    "config:change": []
  };

  register<H extends keyof HookHandlerMap>(
    hookName: H,
    handler: HookHandlerMap[H]
  ): void {
    this.hooks[hookName].push(handler);
  }

  async execute<H extends keyof HookHandlerMap>(
    hookName: H,
    context: Parameters<HookHandlerMap[H]>[0]
  ): Promise<void> {
    const handlers = this.hooks[hookName];
    await Promise.all(handlers.map(handler => handler(context)));
  }
}

// 完整的插件注册表
class PluginRegistry {
  private plugins = new Map<string, PluginDefinition>();
  private hookExecutor = new HookExecutor();

  async register<TName extends string, TConfig>(
    plugin: PluginDefinition<TName, TConfig>
  ): Promise<void> {
    // 验证配置
    if (plugin.configValidation?.type === "function" && plugin.config) {
      const isValid = plugin.configValidation.validate(plugin.config);
      if (!isValid) {
        throw new Error(\`插件 \${plugin.name} 配置验证失败\`);
      }
    }

    // 注册 hooks
    if (plugin.hooks) {
      for (const [hookName, handler] of Object.entries(plugin.hooks)) {
        if (handler) {
          this.hookExecutor.register(
            hookName as keyof HookHandlerMap,
            handler as any
          );
        }
      }
    }

    this.plugins.set(plugin.name, plugin);
    console.log(\`✅ 已注册插件: \${plugin.name} v\${plugin.version}\`);

    // 触发加载 Hook
    await this.hookExecutor.execute("plugin:load", { name: plugin.name });
  }

  async unregister(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    await this.hookExecutor.execute("plugin:unload", { name });
    this.plugins.delete(name);
    console.log(\`✅ 已卸载插件: \${name}\`);
    return true;
  }

  get<TName extends string>(name: TName): PluginDefinition | undefined {
    return this.plugins.get(name);
  }

  getAll(): PluginDefinition[] {
    return Array.from(this.plugins.values());
  }
}

// 使用示例
type LoggerConfig = {
  level: "debug" | "info" | "warn" | "error";
  format: "json" | "text";
};

const loggerPlugin: PluginDefinition<"logger", LoggerConfig> = {
  name: "logger",
  version: "3.0.0",
  description: "日志插件",
  config: {
    level: "info",
    format: "json"
  },
  configValidation: {
    type: "function",
    validate: (config: unknown) => {
      const c = config as LoggerConfig;
      return c.level !== undefined && c.format !== undefined;
    }
  },
  hooks: {
    "plugin:load": async ({ name }) => {
      console.log(\`  └─ Logger 插件加载: \${name}\`);
    },
    "plugin:unload": async ({ name }) => {
      console.log(\`  └─ Logger 插件卸载: \${name}\`);
    },
    "config:change": async ({ config }) => {
      console.log(\`  └─ Logger 配置更新:\`, config);
    }
  }
};

const cachePlugin: PluginDefinition<"cache"> = {
  name: "cache",
  version: "3.0.0",
  description: "缓存插件",
  hooks: {
    "plugin:load": async ({ name }) => {
      console.log(\`  └─ Cache 插件加载: \${name}\`);
    }
  }
};

// 测试
const registry = new PluginRegistry();

console.log("\\n=== 注册插件 ===");
await registry.register(loggerPlugin);
await registry.register(cachePlugin);

console.log("\\n=== 插件列表 ===");
registry.getAll().forEach(p => {
  console.log(\`- \${p.name} v\${p.version}: \${p.description || "无描述"}\`);
});

console.log("\\n=== 卸载插件 ===");
await registry.unregister("logger");

console.log("\\n✅ 完整插件系统（第3版）完成");
`
  }
];

async function generateExamples() {
  console.log("🚀 开始生成简化示例代码...\\n");
  
  for (const example of examples) {
    if (example.status === "created") {
      console.log(\`⏭️  跳过已创建: \${example.file}\`);
      continue;
    }
    
    const filePath = path.join(examplesDir, example.file);
    await fs.writeFile(filePath, example.content);
    console.log(\`✅ 已生成: \${example.file}\`);
  }
  
  console.log("\\n✨ 所有简化示例代码已生成！");
  console.log("\\n📌 现在可以：");
  console.log("1. cd learn/01-typescript-advanced/01-type-system/examples/simplified");
  console.log("2. ts-node 01-basic-generics.ts");
  console.log("3. 或使用 bun run *.ts");
}

generateExamples().catch(console.error);
