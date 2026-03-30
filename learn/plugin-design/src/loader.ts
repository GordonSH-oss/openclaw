import path from "node:path";
import { pathToFileURL } from "node:url";
import { discoverLearningPlugins } from "./discovery.js";
import { resolveLearningPluginEnablement } from "./enablement.js";
import { createLearningPluginApi, type LearningPluginApi } from "./plugin-api.js";
import { createLearningPluginRegistry, type LearningPluginRegistry } from "./registry.js";
import { setActiveLearningPluginRegistry } from "./runtime.js";

type LearningPluginModule = {
  register: (api: LearningPluginApi) => Promise<void> | void;
};

/**
 * learning 版 loader 故意保留真实 OpenClaw 最值得学的一条主线：
 * 先 discover + enablement，再真正 import runtime entry。
 */
export async function loadLearningPlugins(params?: {
  roots?: string[];
  disabledPluginIds?: string[];
  memoryPluginId?: string;
  activate?: boolean;
}): Promise<LearningPluginRegistry> {
  const candidates = await discoverLearningPlugins({ roots: params?.roots });
  const decisions = await resolveLearningPluginEnablement({
    candidates,
    disabledPluginIds: params?.disabledPluginIds,
    memoryPluginId: params?.memoryPluginId,
  });
  const registry = createLearningPluginRegistry();

  for (const decision of decisions) {
    if (!decision.enabled) {
      registry.plugins.push({
        manifest: decision.candidate.manifest,
        capabilities: decision.candidate.manifest.capabilities,
        status: "disabled",
        reason: decision.reason,
      });
      continue;
    }
    const entryPath = path.resolve(decision.candidate.rootDir, decision.candidate.manifest.entry);
    const module = (await import(pathToFileURL(entryPath).href)) as LearningPluginModule;
    if (typeof module.register !== "function") {
      throw new Error(`plugin ${decision.candidate.manifest.id} 缺少 register(api) 导出`);
    }
    const api = createLearningPluginApi({
      manifest: decision.candidate.manifest,
      registry,
    });
    await module.register(api);
    registry.plugins.push({
      manifest: decision.candidate.manifest,
      capabilities: decision.candidate.manifest.capabilities,
      status: "loaded",
    });
  }

  if (params?.activate !== false) {
    setActiveLearningPluginRegistry(registry);
  }
  return registry;
}
