/**
 * OpenClaw 插件类型系统示例
 * 
 * 提取自: src/plugins/types.ts
 * 
 * 展示的概念：
 * 1. 判别联合（PluginConfigValidation）
 * 2. 泛型与类型推断
 * 3. 映射类型（HookMap）
 * 4. 工具类型的组合使用
 */

// ============================================================================
// 1. 插件配置验证（判别联合）
// ============================================================================

// 从 OpenClaw 提取的类型定义
export type PluginConfigValidation =
  | { ok: true; value?: unknown }
  | { ok: false; errors: string[] };

// 👉 使用判别属性 'ok' 来区分成功和失败
// TypeScript 可以根据 ok 的值自动推断其他属性

function handleValidation(result: PluginConfigValidation): void {
  if (result.ok) {
    // 这里 TypeScript 知道 result 有 value 属性
    console.log("✅ 验证成功:", result.value);
  } else {
    // 这里 TypeScript 知道 result 有 errors 属性
    console.log("❌ 验证失败:", result.errors.join(", "));
  }
}

// 测试
handleValidation({ ok: true, value: { port: 3000 } });
handleValidation({ ok: false, errors: ["Missing required field"] });

// ============================================================================
// 2. 插件定义（泛型）
// ============================================================================

// 简化版的 OpenClaw 插件定义
export type PluginHookHandlerMap = {
  "gateway:start": (ctx: { config: unknown }) => Promise<void> | void;
  "agent:before": (ctx: { agentId: string }) => Promise<void> | void;
  "agent:after": (ctx: { agentId: string; result: unknown }) => Promise<void> | void;
};

// 👉 使用泛型让不同插件可以有不同的配置类型
export type OpenClawPluginDefinition<
  TName extends string = string,
  TConfig = unknown
> = {
  name: TName;
  version: string;
  
  // 可选的配置
  config?: TConfig;
  
  // Hook 注册（映射类型）
  hooks?: {
    [H in keyof PluginHookHandlerMap]?: PluginHookHandlerMap[H];
  };
  
  // 配置验证
  configValidation?: {
    validate: (config: unknown) => PluginConfigValidation;
  };
};

// ============================================================================
// 3. 实战示例：Logger 插件
// ============================================================================

// 定义 Logger 的配置类型
type LoggerConfig = {
  level: "debug" | "info" | "warn" | "error";
  format: "json" | "text";
};

// 创建 Logger 插件（类型安全）
const loggerPlugin: OpenClawPluginDefinition<"logger", LoggerConfig> = {
  name: "logger",
  version: "1.0.0",
  
  config: {
    level: "info",
    format: "json"
  },
  
  // 👉 hooks 是类型安全的，只能使用定义的 hook 名称
  hooks: {
    "gateway:start": async ({ config }) => {
      console.log("✅ Gateway 启动，配置:", config);
    },
    
    "agent:before": async ({ agentId }) => {
      console.log(`📝 Agent ${agentId} 开始执行`);
    },
    
    "agent:after": async ({ agentId, result }) => {
      console.log(`✅ Agent ${agentId} 执行完成`);
    }
  },
  
  // 配置验证
  configValidation: {
    validate: (config: unknown): PluginConfigValidation => {
      const c = config as LoggerConfig;
      
      if (!c.level || !c.format) {
        return {
          ok: false,
          errors: ["Missing required fields"]
        };
      }
      
      const validLevels = ["debug", "info", "warn", "error"];
      if (!validLevels.includes(c.level)) {
        return {
          ok: false,
          errors: [`Invalid level: ${c.level}`]
        };
      }
      
      return {
        ok: true,
        value: c
      };
    }
  }
};

console.log("✅ Logger 插件定义:", loggerPlugin.name);

// ============================================================================
// 4. 类型推断：从插件定义提取配置类型
// ============================================================================

// 工具类型：提取插件的配置类型
type ExtractPluginConfig<P> = P extends OpenClawPluginDefinition<string, infer C>
  ? C
  : never;

// 使用
type LoggerConfigExtracted = ExtractPluginConfig<typeof loggerPlugin>;
// 结果: LoggerConfig

// 验证
const config: LoggerConfigExtracted = {
  level: "info",
  format: "json"
};

console.log("✅ 提取的配置类型:", config);

// ============================================================================
// 5. Hook 注册表（映射类型）
// ============================================================================

// OpenClaw 的 Hook 注册表实现
class HookRegistry {
  // 👉 使用映射类型创建类型安全的注册表
  private hooks: {
    [H in keyof PluginHookHandlerMap]: Array<PluginHookHandlerMap[H]>;
  } = {
    "gateway:start": [],
    "agent:before": [],
    "agent:after": []
  };
  
  // 注册 Hook（类型安全）
  register<H extends keyof PluginHookHandlerMap>(
    hookName: H,
    handler: PluginHookHandlerMap[H]
  ): void {
    this.hooks[hookName].push(handler);
  }
  
  // 执行 Hook（类型安全）
  async execute<H extends keyof PluginHookHandlerMap>(
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

// 使用示例
const registry = new HookRegistry();

// 👉 类型安全：hookName 和 context 必须匹配
registry.register("gateway:start", async ({ config }) => {
  console.log("Hook 1: Gateway 启动");
});

registry.register("agent:before", async ({ agentId }) => {
  console.log(`Hook 2: Agent ${agentId} 开始`);
});

// 测试
await registry.execute("gateway:start", { config: { port: 3000 } });
await registry.execute("agent:before", { agentId: "test-123" });

// ============================================================================
// 6. OpenClaw 的设计要点
// ============================================================================

/**
 * OpenClaw 插件系统的类型设计亮点：
 * 
 * 1. **中心化类型定义**
 *    - PluginHookHandlerMap 作为单一数据源
 *    - 所有 Hook 相关的类型都从这里派生
 * 
 * 2. **类型推断**
 *    - 使用 infer 和 Parameters 自动提取类型
 *    - 避免重复定义类型
 * 
 * 3. **类型安全**
 *    - 编译时保证 Hook 名称和参数匹配
 *    - 不可能出现类型不匹配的调用
 * 
 * 4. **可扩展性**
 *    - 添加新 Hook 时，所有相关类型自动更新
 *    - 插件开发者无需关心内部实现
 * 
 * 5. **判别联合**
 *    - 使用 ok 字段区分成功/失败
 *    - TypeScript 自动推断正确的类型
 */

console.log("\n✅ OpenClaw 插件类型系统示例完成");
