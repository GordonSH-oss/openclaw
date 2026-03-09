# 观察者模式与响应式编程详解

> 学习观察者模式和响应式编程在 OpenClaw 中的应用。

## 观察者模式

### 基础概念

观察者模式定义了一对多的依赖关系，当一个对象状态改变时，所有依赖它的对象都会收到通知。

### OpenClaw 的 Channel 监控

```typescript
// src/gateway/server-channels.ts
export function createChannelManager(opts: ChannelManagerOptions) {
  const channels = new Map<string, ChannelInstance>();
  const observers: Array<(event: ChannelEvent) => void> = [];
  
  function notify(event: ChannelEvent): void {
    observers.forEach(observer => {
      try {
        observer(event);
      } catch (error) {
        console.error("Observer failed:", error);
      }
    });
  }
  
  return {
    subscribe(observer: (event: ChannelEvent) => void): void {
      observers.push(observer);
    },
    
    async start(channelName: string): Promise<void> {
      // 启动 channel
      notify({ type: "channel:started", name: channelName });
    },
    
    async stop(channelName: string): Promise<void> {
      // 停止 channel
      notify({ type: "channel:stopped", name: channelName });
    }
  };
}
```

## 响应式编程

### 事件流

```typescript
// WebSocket 广播
export function createBroadcaster() {
  const subscribers = new Set<WebSocket>();
  
  return {
    subscribe(ws: WebSocket): void {
      subscribers.add(ws);
    },
    
    unsubscribe(ws: WebSocket): void {
      subscribers.delete(ws);
    },
    
    broadcast(message: unknown): void {
      const data = JSON.stringify(message);
      for (const ws of subscribers) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      }
    }
  };
}
```

## 设计要点

1. **推送模式**：主动推送数据变化
2. **背压处理**：处理数据过载
3. **内存管理**：及时清理订阅者
4. **错误隔离**：单个观察者失败不影响其他

参考：
- `src/gateway/server-channels.ts`
- `src/gateway/server-broadcast.ts`
