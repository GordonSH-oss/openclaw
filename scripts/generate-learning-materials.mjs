#!/usr/bin/env node
/**
 * 学习材料生成脚本
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const topics = [
  // 第一部分：TypeScript 高级特性
  {
    id: "01",
    title: "类型系统进阶",
    category: "01-typescript-advanced",
    folder: "01-type-system",
    status: "completed",
  },
  {
    id: "02",
    title: "异步编程模式",
    category: "01-typescript-advanced",
    folder: "02-async-patterns",
    keywords: ["Promise", "async/await", "AbortSignal", "并发控制"],
    openclawFiles: [
      "src/infra/backoff.ts",
      "src/agents/pi-embedded-runner/",
      "src/gateway/server-channels.ts",
    ],
  },
  {
    id: "03",
    title: "模块化与动态加载",
    category: "01-typescript-advanced",
    folder: "03-modules",
    keywords: ["ESM", "dynamic import", "jiti", "tree-shaking"],
    openclawFiles: [
      "src/plugins/loader.ts",
      "src/wizard/onboarding.ts",
    ],
  },
  {
    id: "04",
    title: "装饰器与元编程",
    category: "01-typescript-advanced",
    folder: "04-decorators",
    keywords: ["Decorator", "Proxy", "Reflect"],
    openclawFiles: [
      "src/plugins/loader.ts",
    ],
  },
  {
    id: "05",
    title: "Schema 验证",
    category: "01-typescript-advanced",
    folder: "05-schema-validation",
    keywords: ["TypeBox", "Zod", "Schema", "validation"],
    openclawFiles: [
      "src/gateway/protocol/schema/",
      "src/plugins/types.ts",
    ],
  },
  {
    id: "06",
    title: "函数式编程",
    category: "01-typescript-advanced",
    folder: "06-functional",
    keywords: ["高阶函数", "柯里化", "Monad", "函数组合"],
    openclawFiles: [
      "src/infra/retry.ts",
    ],
  },
  
  // 第二部分：核心设计模式
  {
    id: "07",
    title: "插件架构模式",
    category: "02-design-patterns",
    folder: "07-plugin-architecture",
    keywords: ["Plugin", "Registry", "Hook", "Lifecycle"],
    openclawFiles: [
      "src/plugins/loader.ts",
      "src/plugins/types.ts",
      "extensions/",
    ],
  },
  {
    id: "08",
    title: "事件驱动架构",
    category: "02-design-patterns",
    folder: "08-event-driven",
    keywords: ["Event", "Hook", "Pub/Sub", "EventEmitter"],
    openclawFiles: [
      "src/plugins/hooks.ts",
      "src/infra/agent-events.ts",
      "src/gateway/server-broadcast.ts",
    ],
  },
  {
    id: "09",
    title: "工厂与依赖注入",
    category: "02-design-patterns",
    folder: "09-factory-di",
    keywords: ["Factory", "DI", "IoC", "Lazy Init"],
    openclawFiles: [
      "src/context-engine/registry.ts",
      "src/plugins/runtime/index.ts",
    ],
  },
  {
    id: "10",
    title: "策略与状态机",
    category: "02-design-patterns",
    folder: "10-strategy-state",
    keywords: ["Strategy", "State Machine", "Backoff"],
    openclawFiles: [
      "src/infra/backoff.ts",
      "src/channels/registry.ts",
      "src/gateway/auth.ts",
    ],
  },
  {
    id: "11",
    title: "观察者与响应式",
    category: "02-design-patterns",
    folder: "11-observer-reactive",
    keywords: ["Observer", "Reactive", "Stream", "Backpressure"],
    openclawFiles: [
      "src/gateway/server-channels.ts",
    ],
  },
  
  // 第三部分：并发与资源管理
  {
    id: "12",
    title: "队列系统设计",
    category: "03-concurrency",
    folder: "12-queue-systems",
    keywords: ["Queue", "Priority", "Persistent", "Multi-lane"],
    openclawFiles: [
      "src/process/command-queue.ts",
      "src/plugin-sdk/keyed-async-queue.ts",
      "src/infra/outbound/delivery-queue.ts",
    ],
  },
  {
    id: "13",
    title: "并发控制与限流",
    category: "03-concurrency",
    folder: "13-concurrency-control",
    keywords: ["Rate Limit", "Backpressure", "Circuit Breaker", "Semaphore"],
    openclawFiles: [
      "src/gateway/auth-rate-limit.ts",
      "src/gateway/control-plane-rate-limit.ts",
      "src/process/command-queue.ts",
    ],
  },
  {
    id: "14",
    title: "错误处理与重试",
    category: "03-concurrency",
    folder: "14-error-retry",
    keywords: ["Retry", "Exponential Backoff", "Jitter", "Circuit Breaker"],
    openclawFiles: [
      "src/infra/retry.ts",
      "src/infra/backoff.ts",
      "src/infra/outbound/delivery-queue.ts",
    ],
  },
  {
    id: "15",
    title: "优雅关闭",
    category: "03-concurrency",
    folder: "15-graceful-shutdown",
    keywords: ["Graceful Shutdown", "Cleanup", "Signal Handling"],
    openclawFiles: [
      "src/gateway/server-close.ts",
      "src/process/command-queue.ts",
    ],
  },
  
  // 第四部分：网络通信与协议
  {
    id: "16",
    title: "WebSocket 双向通信",
    category: "04-networking",
    folder: "16-websocket",
    keywords: ["WebSocket", "Connection", "Heartbeat", "Reconnect"],
    openclawFiles: [
      "src/gateway/server/ws-connection.ts",
      "src/gateway/server-broadcast.ts",
    ],
  },
  {
    id: "17",
    title: "RPC 协议设计",
    category: "04-networking",
    folder: "17-rpc-protocol",
    keywords: ["RPC", "JSON-RPC", "Request/Response", "Schema"],
    openclawFiles: [
      "src/gateway/protocol/schema/",
      "src/gateway/server-methods.ts",
    ],
  },
  {
    id: "18",
    title: "认证与授权",
    category: "04-networking",
    folder: "18-auth-authz",
    keywords: ["Auth", "Token", "RBAC", "OAuth"],
    openclawFiles: [
      "src/gateway/auth.ts",
      "src/infra/device-pairing.ts",
      "src/gateway/role-policy.ts",
    ],
  },
  {
    id: "19",
    title: "TLS 与证书管理",
    category: "04-networking",
    folder: "19-tls-certs",
    keywords: ["TLS", "Certificate", "OpenSSL", "Self-signed"],
    openclawFiles: [
      "src/infra/tls/gateway.ts",
    ],
  },
  
  // 第五部分：架构与最佳实践
  {
    id: "20",
    title: "微服务架构",
    category: "05-architecture",
    folder: "20-microservices",
    keywords: ["Microservices", "Gateway", "Service Discovery"],
    openclawFiles: [
      "src/gateway/server.impl.ts",
    ],
  },
  {
    id: "21",
    title: "配置管理与热重载",
    category: "05-architecture",
    folder: "21-config-reload",
    keywords: ["Config", "Hot Reload", "Migration", "Watch"],
    openclawFiles: [
      "src/config/config.ts",
      "src/gateway/config-reload.ts",
      "src/config/config.js",
    ],
  },
  {
    id: "22",
    title: "日志与监控",
    category: "05-architecture",
    folder: "22-logging-monitoring",
    keywords: ["Logging", "Structured Log", "Metrics", "Tracing"],
    openclawFiles: [
      "src/logging/subsystem.ts",
      "src/infra/diagnostic-events.ts",
    ],
  },
  {
    id: "23",
    title: "测试策略",
    category: "05-architecture",
    folder: "23-testing",
    keywords: ["Unit Test", "Integration Test", "E2E", "Mock"],
    openclawFiles: [
      "src/test-utils/",
    ],
  },
];

const learnDir = path.join(__dirname, "../learn");

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    // 目录已存在
  }
}

async function generateTopicSkeleton(topic) {
  if (topic.status === "completed") {
    console.log(`⏭️  跳过已完成主题: ${topic.id} - ${topic.title}`);
    return;
  }

  const topicDir = path.join(learnDir, topic.category, topic.folder);
  
  console.log(`📝 生成主题: ${topic.id} - ${topic.title}`);
  
  // 创建目录结构
  await ensureDir(topicDir);
  await ensureDir(path.join(topicDir, "theory"));
  await ensureDir(path.join(topicDir, "examples/openclaw"));
  await ensureDir(path.join(topicDir, "examples/simplified"));
  await ensureDir(path.join(topicDir, "exercises"));
  await ensureDir(path.join(topicDir, "exercises/solutions"));
  await ensureDir(path.join(topicDir, "projects"));
  await ensureDir(path.join(topicDir, "projects/starter"));
  await ensureDir(path.join(topicDir, "projects/tests"));
  await ensureDir(path.join(topicDir, "assets/diagrams"));
  
  // 生成 README.md
  const readmeContent = `# ${topic.id}. ${topic.title}

## 学习目标

通过本主题的学习，你将掌握：

TODO: 添加学习目标

## 内容结构

### 📚 理论学习（约 X 小时）

阅读 [theory/guide.md](./theory/guide.md)

### 💻 代码示例（约 X 小时）

1. **OpenClaw 真实示例** - [examples/openclaw/](./examples/openclaw/)
2. **简化示例** - [examples/simplified/](./examples/simplified/)

### ✏️ 练习题（约 X 小时）

完成 [exercises/problems.md](./exercises/problems.md)

### 🚀 实战项目（约 X 小时）

参考 [projects/requirements.md](./projects/requirements.md)

## 关键概念

${topic.keywords ? topic.keywords.map(k => `- ${k}`).join("\n") : "TODO: 添加关键概念"}

## OpenClaw 代码导航

${topic.openclawFiles ? topic.openclawFiles.map(f => `- \`${f}\``).join("\n") : "TODO: 添加源码路径"}

## 学习检查清单

- [ ] 完成理论学习
- [ ] 理解 OpenClaw 示例
- [ ] 完成简化示例
- [ ] 完成至少 3 道练习题
- [ ] 完成实战项目

## 下一步

完成本主题后，继续学习下一个主题。
`;
  
  await fs.writeFile(path.join(topicDir, "README.md"), readmeContent);
  
  // 生成 theory/guide.md 占位符
  const theoryContent = `# ${topic.title} 详解

> 本指南通过 OpenClaw 的真实代码示例，深入讲解${topic.title}。

## 目录

TODO: 添加目录

## 1. 基础概念

TODO: 添加基础概念讲解

## 2. OpenClaw 实战

TODO: 添加 OpenClaw 代码分析

## 3. 最佳实践

TODO: 添加最佳实践

## 4. 常见陷阱

TODO: 添加常见错误和解决方案

---

**参考资源：**

${topic.openclawFiles ? topic.openclawFiles.map(f => `- \`${f}\``).join("\n") : ""}
`;
  
  await fs.writeFile(path.join(topicDir, "theory/guide.md"), theoryContent);
  
  // 生成 exercises/problems.md 占位符
  const exercisesContent = `# ${topic.title} - 练习题

## 练习 1

TODO: 添加练习题

## 练习 2

TODO: 添加练习题

## 练习 3

TODO: 添加练习题

---

参考答案在 [solutions/](./solutions/) 目录中。
`;
  
  await fs.writeFile(path.join(topicDir, "exercises/problems.md"), exercisesContent);
  
  // 生成 projects/requirements.md 占位符
  const projectContent = `# 项目：TODO

## 项目概述

TODO: 添加项目描述

## 功能需求

TODO: 添加功能需求

## 实现要求

TODO: 添加实现要求

## 测试用例

TODO: 添加测试用例

---

**祝你好运！**
`;
  
  await fs.writeFile(path.join(topicDir, "projects/requirements.md"), projectContent);
  
  console.log(`✅ 完成主题骨架: ${topic.id} - ${topic.title}`);
}

// 主函数
async function main() {
  console.log("🚀 开始生成学习材料骨架...\n");
  
  for (const topic of topics) {
    await generateTopicSkeleton(topic);
  }
  
  console.log("\n✨ 学习材料骨架生成完成！");
  console.log("\n📌 下一步：");
  console.log("1. 填充每个主题的 theory/guide.md");
  console.log("2. 添加 OpenClaw 代码示例");
  console.log("3. 创建简化示例");
  console.log("4. 编写练习题和项目要求");
  console.log("5. 绘制架构图和流程图");
}

main().catch(console.error);
