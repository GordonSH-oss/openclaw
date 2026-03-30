import type { LearningPluginApi } from "../../../plugin-api.js";

export function register(api: LearningPluginApi): void {
  api.registerChannel({
    id: "mock-channel",
    title: "Mock Channel",
    normalizeInbound(input) {
      return {
        channel: "mock-channel",
        peerId: String(input.peerId ?? "unknown"),
      };
    },
  });
  api.registerGatewayMethod({
    name: "gateway.mock.ping",
    handle: async (params) => ({
      ok: true,
      echoed: params.echo ?? "pong",
      source: api.id,
      method: "gateway.mock.ping",
    }),
  });
  api.registerHook({
    event: "before_agent_start",
    handle: () => undefined,
  });
}
