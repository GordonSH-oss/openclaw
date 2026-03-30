import type { LearningPluginApi } from "../../../plugin-api.js";

export function register(api: LearningPluginApi): void {
  api.registerMemoryRuntime({
    id: "mock-memory",
    async search(query) {
      return [`mock-memory search hit: ${query}`];
    },
    async read(target) {
      return `mock-memory read: ${target}`;
    },
    async write(note) {
      return `mock-memory wrote: ${note}`;
    },
  });
}
