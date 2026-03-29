/**
 * index.ts — 启动入口
 *
 * 直接运行：npx tsx src/index.ts
 * 或：npm run dev
 */

import { createGateway } from "./server.js";

const gateway = await createGateway({
  port: 8789,
  host: "127.0.0.1",
  defaultAgentId: "default",

  // 示例 binding 规则：
  // 可以根据 channel 和 accountId 把消息路由到不同 agent
  bindings: [
    // 将 mock channel 上 "vip-user" 的消息路由到 "vip-agent"
    { match: { channel: "mock", accountId: "vip-user" }, agentId: "vip-agent" },
    // 其他 mock channel 消息 → 默认 agent
    { match: { channel: "mock" }, agentId: "default" },
  ],
});

// 优雅关闭处理
process.on("SIGINT", async () => {
  console.log("\n收到 SIGINT，正在关闭...");
  await gateway.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n收到 SIGTERM，正在关闭...");
  await gateway.close();
  process.exit(0);
});
