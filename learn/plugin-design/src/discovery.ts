import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Dirent } from "node:fs";
import {
  LEARNING_PLUGIN_MANIFEST_FILE,
  readLearningPluginManifest,
  type LearningPluginManifest,
} from "./manifest.js";

export type LearningPluginCandidate = {
  rootDir: string;
  manifestPath: string;
  manifest: LearningPluginManifest;
};

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function discoverLearningPlugins(params?: {
  roots?: string[];
}): Promise<LearningPluginCandidate[]> {
  const defaultRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "plugins");
  const roots = (params?.roots?.length ? params.roots : [defaultRoot])
    .map((value) => path.resolve(value));
  const candidates: LearningPluginCandidate[] = [];
  for (const root of roots) {
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const pluginRoot = path.join(root, entry.name);
      const manifestPath = path.join(pluginRoot, LEARNING_PLUGIN_MANIFEST_FILE);
      try {
        await fs.access(manifestPath);
      } catch {
        continue;
      }
      if (!isPathInside(root, pluginRoot)) {
        continue;
      }
      const manifest = await readLearningPluginManifest(pluginRoot);
      candidates.push({
        rootDir: pluginRoot,
        manifestPath,
        manifest,
      });
    }
  }
  return candidates.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}
