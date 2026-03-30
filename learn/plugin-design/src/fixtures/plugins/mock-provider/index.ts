import type { LearningPluginApi } from "../../../plugin-api.js";

export function register(api: LearningPluginApi): void {
  api.registerProvider({
    id: "mock-provider",
    models: ["mock-provider/fast", "mock-provider/reliable"],
  });
  api.registerTool({
    id: "mock-provider.describe",
    description: "Describe the learning provider surface",
    invoke: async () => "mock-provider tool invoked",
  });
}
