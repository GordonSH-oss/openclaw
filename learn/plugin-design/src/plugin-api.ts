import type { LearningPluginManifest } from "./manifest.js";
import type {
  LearningChannelRegistration,
  LearningGatewayMethodRegistration,
  LearningHookRegistration,
  LearningMemoryRuntime,
  LearningPluginRegistry,
  LearningProviderRegistration,
  LearningToolRegistration,
} from "./registry.js";

export type LearningPluginApi = {
  id: string;
  manifest: LearningPluginManifest;
  registerProvider(provider: LearningProviderRegistration): void;
  registerChannel(channel: LearningChannelRegistration): void;
  registerTool(tool: LearningToolRegistration): void;
  registerGatewayMethod(method: LearningGatewayMethodRegistration): void;
  registerHook(hook: LearningHookRegistration): void;
  registerMemoryRuntime(runtime: LearningMemoryRuntime): void;
};

export function createLearningPluginApi(params: {
  manifest: LearningPluginManifest;
  registry: LearningPluginRegistry;
}): LearningPluginApi {
  return {
    id: params.manifest.id,
    manifest: params.manifest,
    registerProvider(provider) {
      params.registry.providers.push(provider);
    },
    registerChannel(channel) {
      params.registry.channels.push(channel);
    },
    registerTool(tool) {
      params.registry.tools.push(tool);
    },
    registerGatewayMethod(method) {
      params.registry.gatewayMethods.push(method);
    },
    registerHook(hook) {
      params.registry.hooks.push(hook);
    },
    registerMemoryRuntime(runtime) {
      params.registry.memoryRuntime = runtime;
    },
  };
}
