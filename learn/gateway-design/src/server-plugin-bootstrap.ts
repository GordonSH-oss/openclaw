import { ChannelRegistry, MockChannel } from "./channels.js";

export function bootstrapGatewayChannels(): {
  channelRegistry: ChannelRegistry;
  mockChannel: MockChannel;
} {
  const channelRegistry = new ChannelRegistry();
  const mockChannel = new MockChannel();
  channelRegistry.register(mockChannel);
  return { channelRegistry, mockChannel };
}
