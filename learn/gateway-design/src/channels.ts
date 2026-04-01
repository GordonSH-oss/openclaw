/**
 * channels.ts — Channel 插件接口和注册表
 *
 * 【设计模式】插件化的 Channel 抽象
 *
 * Gateway 不关心消息从哪里来（Telegram、Discord、Web、CLI...），
 * 只关心收到一个"标准化的消息上下文"，然后交给 agent 处理，
 * 最后把 agent 回复通过原来的 channel 发回去。
 *
 * 通过定义 Channel 接口，每种消息来源只需要实现这个接口，
 * Gateway 就能统一处理，无需修改核心逻辑。
 *
 * 【类比】就像插座和插头：
 * - 插座（Gateway）定义了标准接口
 * - 插头（Channel 插件）各种各样，但都符合接口标准
 * - 设备（Agent）不需要知道电是从哪里来的
 */

import type { InboundMessageSource } from "./routing.js";

// ─── 标准化消息上下文 ──────────────────────────────────────────────────────────

/**
 * 标准化的入站消息上下文
 *
 * 不管消息来自哪个 channel，都会被标准化成这个格式。
 * Agent 只看这个格式，不关心原始来源。
 */
export type InboundMessage = {
  /** 消息正文 */
  body: string;
  /** 消息来源信息（用于路由） */
  source: InboundMessageSource;
  /** 时间戳 */
  timestamp: number;
  /** 来源平台的原始消息 ID（用于去重） */
  rawMessageId?: string;
  /** 附件列表 */
  attachments?: InboundAttachment[];
  /** 是否 @ 了 bot（用于群组场景的触发判断） */
  wasMentioned?: boolean;
};

export type InboundAttachment = {
  type: "image" | "file" | "audio";
  url?: string;
  data?: string; // base64
  mimeType?: string;
  fileName?: string;
};

/**
 * 回复一条消息所需的上下文（用于 channel 发送回复）
 */
export type OutboundReplyContext = {
  /** 回复发送到哪个 channel */
  channel: string;
  /** 回复的目标（如 chat_id、user_id、channel_id） */
  to: string;
  /** 可选：线程 ID（如 Discord thread、Slack thread） */
  threadId?: string;
};

// ─── Channel 插件接口 ──────────────────────────────────────────────────────────

/**
 * Channel 插件需要实现的接口
 *
 * 每个 channel 插件负责：
 * 1. 监听来自对应平台的消息（Telegram webhook、Discord event、WebSocket 等）
 * 2. 把原始消息标准化成 InboundMessage
 * 3. 回调 Gateway 的 onMessage 处理器
 * 4. 实现 sendReply 把 agent 的回复发出去
 */
export type ChannelPlugin = {
  /** channel 唯一标识，如 "telegram"、"discord"、"web" */
  id: string;
  /** 人类可读名称 */
  displayName: string;

  /**
   * 启动 channel（开始监听消息）
   * Gateway 启动时调用，传入消息处理回调
   */
  start(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void>;

  /**
   * 停止 channel（清理资源）
   * Gateway 关闭时调用
   */
  stop(): Promise<void>;

  /**
   * 发送回复
   * Agent 生成回复后，Gateway 调用这个方法把回复发给用户
   */
  sendReply(context: OutboundReplyContext, text: string): Promise<void>;

  /**
   * 获取 channel 当前状态
   */
  getStatus(): ChannelStatus;
};

export type ChannelStatus = {
  connected: boolean;
  error?: string;
  connectedAt?: number;
};

// ─── Channel 注册表 ────────────────────────────────────────────────────────────

/**
 * Channel 注册表
 * 管理所有已注册的 channel 插件
 */
export class ChannelRegistry {
  private channels = new Map<string, ChannelPlugin>();

  /**
   * 注册一个 channel 插件
   */
  register(plugin: ChannelPlugin): void {
    if (this.channels.has(plugin.id)) {
      console.warn(`[channels] Channel ${plugin.id} 已注册，将被覆盖`);
    }
    this.channels.set(plugin.id, plugin);
    console.log(`[channels] 注册 channel: ${plugin.displayName} (${plugin.id})`);
  }

  /**
   * 获取指定 channel 插件
   */
  get(channelId: string): ChannelPlugin | undefined {
    return this.channels.get(channelId);
  }

  /**
   * 获取所有已注册的 channel ID
   */
  listIds(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * 启动所有 channel，传入统一的消息处理回调
   */
  async startAll(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    for (const plugin of this.channels.values()) {
      try {
        await plugin.start(onMessage);
        console.log(`[channels] ${plugin.displayName} 已启动`);
      } catch (err) {
        console.error(`[channels] ${plugin.displayName} 启动失败:`, err);
      }
    }
  }

  /**
   * 停止所有 channel
   */
  async stopAll(): Promise<void> {
    for (const plugin of this.channels.values()) {
      try {
        await plugin.stop();
      } catch {
        // 忽略停止错误
      }
    }
  }
}

// ─── 内置 channel：模拟 channel（用于测试和学习）────────────────────────────

/**
 * MockChannel：一个简单的模拟 channel，用于本地测试
 *
 * 它不连接任何真实平台，而是通过 programmatic API 模拟发消息。
 * 在测试和演示中非常有用。
 */
export class MockChannel implements ChannelPlugin {
  readonly id = "mock";
  readonly displayName = "Mock Channel (测试用)";

  private messageHandler?: (msg: InboundMessage) => Promise<void>;
  private status: ChannelStatus = { connected: false };
  private sentReplies: Array<{ context: OutboundReplyContext; text: string }> = [];

  async start(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    this.messageHandler = onMessage;
    this.status = { connected: true, connectedAt: Date.now() };
  }

  async stop(): Promise<void> {
    this.messageHandler = undefined;
    this.status = { connected: false };
  }

  async sendReply(context: OutboundReplyContext, text: string): Promise<void> {
    console.log(`[mock-channel] 回复给 ${context.to}: ${text}`);
    this.sentReplies.push({ context, text });
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  /**
   * 模拟发送一条入站消息（测试时使用）
   */
  async simulateInbound(params: {
    body: string;
    userId: string;
    channelType?: "direct" | "group";
    groupId?: string;
  }): Promise<void> {
    if (!this.messageHandler) {
      throw new Error("Channel 还未启动");
    }
    await this.messageHandler({
      body: params.body,
      source: {
        channel: "mock",
        accountId: params.userId,
        peer:
          params.channelType === "group" && params.groupId
            ? { kind: "group", id: params.groupId }
            : { kind: "direct", id: params.userId },
      },
      timestamp: Date.now(),
      rawMessageId: `mock-${Date.now()}`,
    });
  }

  /**
   * 获取所有已发送的回复（用于测试断言）
   */
  getSentReplies() {
    return this.sentReplies;
  }
}
