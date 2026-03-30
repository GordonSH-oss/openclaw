import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverLearningPlugins, loadLearningPlugins, validateLearningPluginManifest } from "./index.js";

const FIXTURE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "plugins");

test("manifest validation rejects invalid plugin definitions", () => {
  assert.throws(
    () =>
      validateLearningPluginManifest({
        id: "broken",
        name: "Broken",
        version: "0.1.0",
        entry: "./index.ts",
        capabilities: [],
      }),
    /至少需要一个 capability/,
  );
});

test("discovery only finds plugins inside allowed roots", async () => {
  const plugins = await discoverLearningPlugins({ roots: [FIXTURE_ROOT] });
  assert.deepEqual(
    plugins.map((plugin) => plugin.manifest.id),
    ["mock-channel", "mock-memory", "mock-provider"],
  );
});

test("enablement and loader expose registry consumption surfaces", async () => {
  const registry = await loadLearningPlugins({
    roots: [FIXTURE_ROOT],
    memoryPluginId: "mock-memory",
  });
  assert.equal(registry.plugins.find((plugin) => plugin.manifest.id === "mock-channel")?.status, "loaded");
  assert.equal(registry.providers.length, 1);
  assert.equal(registry.memoryRuntime?.id, "mock-memory");
  assert.equal(registry.gatewayMethods.some((method) => method.name === "gateway.mock.ping"), true);
});

test("enablement can disable a plugin deterministically", async () => {
  const registry = await loadLearningPlugins({
    roots: [FIXTURE_ROOT],
    disabledPluginIds: ["mock-channel"],
  });
  assert.equal(registry.plugins.find((plugin) => plugin.manifest.id === "mock-channel")?.status, "disabled");
});

test("memory runtime plugin can replace the default memory behavior", async () => {
  const registry = await loadLearningPlugins({
    roots: [FIXTURE_ROOT],
    memoryPluginId: "mock-memory",
  });
  const result = await registry.memoryRuntime?.write("remember plugin boundary");
  assert.match(result ?? "", /mock-memory wrote/i);
});
