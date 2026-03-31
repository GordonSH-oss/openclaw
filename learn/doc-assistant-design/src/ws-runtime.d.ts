export const WebSocketServer: new (...args: unknown[]) => {
  on(event: string, listener: (...args: unknown[]) => void): void;
  close(): void;
};

declare const WebSocket: {
  new (url: string): {
    on(event: string, listener: (...args: unknown[]) => void): void;
    send(data: string): void;
    close(): void;
  };
};

export default WebSocket;
