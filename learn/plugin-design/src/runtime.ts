import type { LearningPluginRegistry } from "./registry.js";

let activeLearningPluginRegistry: LearningPluginRegistry | null = null;

export function setActiveLearningPluginRegistry(registry: LearningPluginRegistry): void {
  activeLearningPluginRegistry = registry;
}

export function getActiveLearningPluginRegistry(): LearningPluginRegistry {
  if (!activeLearningPluginRegistry) {
    throw new Error("learning plugin registry 尚未激活");
  }
  return activeLearningPluginRegistry;
}
