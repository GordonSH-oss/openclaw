# OpenClaw 源码快速参考

> 快速查找关键代码位置和模式的速查表。

## 🔍 快速查找

### 启动入口

| 需求 | 位置 | 说明 |
|------|------|------|
| CLI 入口 | `src/entry.ts` | 进程启动和环境准备 |
| 主模块 | `src/index.ts` | 公共 API 导出 |
| Gateway 启动 | `src/gateway/server.impl.ts:startGatewayServer` | Gateway 主函数 |
| CLI 命令定义 | `src/cli/program.ts:buildProgram` | 所有 CLI 命令 |

### 插件系统

| 需求 | 位置 |
|------|------|
| 插件类型定义 | `src/plugins/types.ts:OpenClawPluginDefinition` |
| Hook 类型定义 | `src/plugins/types.ts:PluginHookHandlerMap` |
| 插件加载 | `src/plugins/loader.ts:loadGatewayPlugins` |
| Hook 执行 | `src/plugins/hooks.ts:runVoidHook` |
| 插件运行时 | `src/plugins/runtime/index.ts:createPluginRuntime` |

### Gateway 核心

| 需求 | 位置 |
|------|------|
| WebSocket 服务器 | `src/gateway/server-ws-runtime.ts:attachGatewayWsHandlers` |
| HTTP 服务器 | `src/gateway/server-http.ts:createGatewayHttpApp` |
| RPC 方法处理 | `src/gateway/server-methods.ts:handleGatewayRequest` |
| Channel 管理 | `src/gateway/server-channels.ts:createChannelManager` |
| 广播机制 | `src/gateway/server-broadcast.ts:createBroadcaster` |
| 优雅关闭 | `src/gateway/server-close.ts:createGatewayCloseHandler` |

### Channel 实现

| Channel | 位置 |
|---------|------|
| Telegram | `src/telegram/` |
| Discord | `src/discord/` |
| Slack | `src/slack/` |
| Signal | `src/signal/` |
| WhatsApp Web | `src/web/` |

### 并发控制

| 需求 | 位置 |
|------|------|
| 命令队列 | `src/process/command-queue.ts` |
| 键控队列 | `src/plugin-sdk/keyed-async-queue.ts` |
| 持久化队列 | `src/infra/outbound/delivery-queue.ts` |
| 限流（认证） | `src/gateway/auth-rate-limit.ts` |
| 限流（控制面） | `src/gateway/control-plane-rate-limit.ts` |

### 错误处理

| 需求 | 位置 |
|------|------|
| 重试机制 | `src/infra/retry.ts:retryAsync` |
| 退避策略 | `src/infra/backoff.ts:computeBackoff` |
| 错误格式化 | `src/infra/errors.ts:formatUncaughtError` |

### 配置系统

| 需求 | 位置 |
|------|------|
| 配置加载 | `src/config/config.ts:loadConfig` |
| 配置迁移 | `src/config/config.js:migrateLegacyConfig` |
| 配置热重载 | `src/gateway/config-reload.ts:startGatewayConfigReloader` |
| 会话管理 | `src/config/sessions.ts` |

---

## 📦 常用代码模式

### 1. 创建 Logger

```typescript
import { createSubsystemLogger } from "./logging/subsystem.js";

const log = createSubsystemLogger("my-module");
const logChild = log.child("sub-component");

log.info("Message");
log.error("Error", error);
```

### 2. 注册插件 Hook

```typescript
export default {
  name: "my-plugin",
  version: "1.0.0",
  hooks: {
    "gateway:start": async ({ config }) => {
      // 初始化代码
    },
    "agent:before": async ({ agentId }) => {
      // Agent 执行前
    }
  }
};
```

### 3. 创建 Channel 插件

```typescript
export const myChannelPlugin: ChannelPlugin = {
  id: "my-channel",
  name: "My Channel",
  
  async start(opts) {
    // 启动逻辑
    return {
      async stop() {
        // 停止逻辑
      }
    };
  }
};
```

### 4. 使用命令队列

```typescript
import { enqueueCommand } from "./process/command-queue.js";

await enqueueCommand({
  sessionKey: "user-123",
  priority: "normal",
  task: async () => {
    // 执行任务
  }
});
```

### 5. 使用重试机制

```typescript
import { retryAsync } from "./infra/retry.ts";

const result = await retryAsync({
  operation: async () => {
    // 可能失败的操作
  },
  maxAttempts: 3,
  backoffPolicy: "exponential",
  baseDelay: 1000
});
```

---

## 🎯 调试检查清单

### Gateway 不启动

```bash
# 1. 检查端口占用
ss -ltnp | grep 18789

# 2. 查看 Gateway 日志
./scripts/clawlog.sh --follow

# 3. 检查配置
openclaw config get

# 4. 验证依赖
pnpm install

# 5. 重新构建
pnpm build
```

### 插件不加载

```bash
# 1. 列出已加载的插件
openclaw plugins list

# 2. 检查插件目录
ls -la plugins/ extensions/

# 3. 验证插件配置
openclaw config get plugins

# 4. 查看插件日志
grep "plugin" ~/.openclaw/logs/latest.log
```

### Channel 连接失败

```bash
# 1. 检查 Channel 状态
openclaw channels status --deep

# 2. 重启特定 Channel
openclaw channels restart telegram

# 3. 查看认证状态
openclaw auth status

# 4. 检查网络连接
ping api.telegram.org
```

---

## 🔗 相关文档

- [完整源码阅读指南](./SOURCE_CODE_GUIDE.md)
- [TypeScript 类型系统](./01-typescript-advanced/01-type-system/README.md)
- [插件架构模式](./02-design-patterns/07-plugin-architecture/README.md)
- [项目主 README](../README.md)
- [在线文档](https://docs.openclaw.ai/)
