import fs from "node:fs/promises";
import path from "node:path";

export type LearningPluginCapability =
  | "provider"
  | "channel"
  | "tool"
  | "gatewayMethod"
  | "hook"
  | "memoryRuntime";

export type LearningPluginManifest = {
  id: string;
  name: string;
  version: string;
  entry: string;
  capabilities: LearningPluginCapability[];
  enabledByDefault?: boolean;
  slot?: "memory";
};

export const LEARNING_PLUGIN_MANIFEST_FILE = "learning.plugin.json";

export function validateLearningPluginManifest(input: unknown): LearningPluginManifest {
  if (!input || typeof input !== "object") {
    throw new Error("plugin manifest 必须是对象");
  }
  const record = input as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const version = typeof record.version === "string" ? record.version.trim() : "";
  const entry = typeof record.entry === "string" ? record.entry.trim() : "";
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.filter((value): value is LearningPluginCapability =>
        typeof value === "string" &&
        [
          "provider",
          "channel",
          "tool",
          "gatewayMethod",
          "hook",
          "memoryRuntime",
        ].includes(value),
      )
    : [];
  if (!id || !name || !version || !entry) {
    throw new Error("plugin manifest 缺少必填字段：id/name/version/entry");
  }
  if (capabilities.length === 0) {
    throw new Error("plugin manifest 至少需要一个 capability");
  }
  if (record.slot !== undefined && record.slot !== "memory") {
    throw new Error("learning 版目前只支持 memory slot");
  }
  return {
    id,
    name,
    version,
    entry,
    capabilities,
    enabledByDefault: record.enabledByDefault !== false,
    slot: record.slot === "memory" ? "memory" : undefined,
  };
}

export async function readLearningPluginManifest(rootDir: string): Promise<LearningPluginManifest> {
  const manifestPath = path.join(rootDir, LEARNING_PLUGIN_MANIFEST_FILE);
  const raw = await fs.readFile(manifestPath, "utf-8");
  return validateLearningPluginManifest(JSON.parse(raw));
}
