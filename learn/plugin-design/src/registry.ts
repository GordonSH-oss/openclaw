import type { LearningPluginCapability, LearningPluginManifest } from "./manifest.js";

export type LearningProviderRegistration = {
  id: string;
  models: string[];
};

export type LearningChannelRegistration = {
  id: string;
  title: string;
  normalizeInbound?: (input: Record<string, unknown>) => Record<string, unknown>;
};

export type LearningToolRegistration = {
  id: string;
  description: string;
  invoke: (input: Record<string, unknown>) => Promise<string> | string;
};

export type LearningGatewayMethodRegistration = {
  name: string;
  handle: (params: Record<string, unknown>) => Promise<unknown> | unknown;
};

export type LearningHookRegistration = {
  event: string;
  handle: (payload: Record<string, unknown>) => Promise<void> | void;
};

export type LearningMemoryRuntime = {
  id: string;
  search: (query: string) => Promise<string[]> | string[];
  read: (target: string) => Promise<string> | string;
  write: (note: string) => Promise<string> | string;
};

export type LearningPluginRecord = {
  manifest: LearningPluginManifest;
  capabilities: LearningPluginCapability[];
  status: "loaded" | "disabled";
  reason?: string;
};

export type LearningPluginRegistry = {
  plugins: LearningPluginRecord[];
  providers: LearningProviderRegistration[];
  channels: LearningChannelRegistration[];
  tools: LearningToolRegistration[];
  gatewayMethods: LearningGatewayMethodRegistration[];
  hooks: LearningHookRegistration[];
  memoryRuntime?: LearningMemoryRuntime;
};

export function createLearningPluginRegistry(): LearningPluginRegistry {
  return {
    plugins: [],
    providers: [],
    channels: [],
    tools: [],
    gatewayMethods: [],
    hooks: [],
  };
}
