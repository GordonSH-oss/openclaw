import { loadLearningPlugins, type LearningPluginRegistry } from "../../plugin-design/src/index.js";
import { ChannelRegistry, MockChannel } from "./channels.js";

export async function bootstrapGatewayChannels(): Promise<{
  channelRegistry: ChannelRegistry;
  mockChannel: MockChannel;
  pluginRegistry: LearningPluginRegistry;
}> {
  const channelRegistry = new ChannelRegistry();
  const mockChannel = new MockChannel();
  channelRegistry.register(mockChannel);
  const pluginRegistry = await loadLearningPlugins();
  return { channelRegistry, mockChannel, pluginRegistry };
}
