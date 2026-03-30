import test from "node:test";
import assert from "node:assert/strict";
import { resolveAgentRoute } from "./routing.js";
import { createGatewayRuntimeState } from "./server-runtime-state.js";
import { launchGatewayAgentRun } from "./methods/agent.js";
import { getOrCreateSession, resolveGatewayAgentDataDir } from "./session-store.js";
import { loadGatewayTranscript } from "./transcript-store.js";
import {
  sessionsMessagesSubscribeHandler,
  sessionsMessagesUnsubscribeHandler,
} from "./methods/sessions.js";
import { loadLearningPlugins } from "../../plugin-design/src/index.js";

test("routing priority is peer > account > channel > default", () => {
  const route = resolveAgentRoute({
    source: {
      channel: "mock",
      accountId: "u-1",
      peer: { kind: "group", id: "g-1" },
    },
    bindings: [
      { match: { channel: "mock" }, agentId: "fallback" },
      { match: { channel: "mock", accountId: "u-1" }, agentId: "account" },
      { match: { channel: "mock", peer: { kind: "group", id: "g-1" } }, agentId: "peer" },
    ],
    defaultAgentId: "default",
  });
  assert.equal(route.agentId, "peer");
});

test("agent run is accepted immediately and later reaches terminal state", async () => {
  await loadLearningPlugins();
  const state = createGatewayRuntimeState();
  const { entry } = await getOrCreateSession("default/main", {
    lastChannel: "gateway",
  });
  const run = launchGatewayAgentRun({
    state,
    message: "请帮我计算: 10 + 5",
    sessionKey: "default/main",
    sessionId: entry.sessionId,
    runId: "gw-run-1",
  });
  assert.equal(run.accepted.status, "accepted");
  const terminal = await run.completion;
  assert.equal(terminal.status, "ok");
});

test("session message subscriptions can be added and removed", () => {
  const state = createGatewayRuntimeState();
  const client = {
    connId: "c-1",
    authenticated: true,
    scopes: ["admin", "read"],
    connect: {},
  };
  let response: unknown;
  sessionsMessagesSubscribeHandler({
    request: { id: "1", method: "sessions.messages.subscribe", params: { sessionKey: "default/main" } },
    respond: (_ok, result) => {
      response = result;
    },
    client,
    state,
  });
  assert.deepEqual(response, { subscribed: true, sessionKey: "default/main" });
  assert.equal(state.chat.sessionMessageSubscribers.get("default/main")?.has("c-1"), true);

  sessionsMessagesUnsubscribeHandler({
    request: { id: "2", method: "sessions.messages.unsubscribe", params: { sessionKey: "default/main" } },
    respond: (_ok, result) => {
      response = result;
    },
    client,
    state,
  });
  assert.deepEqual(response, { unsubscribed: true, sessionKey: "default/main" });
  assert.equal(state.chat.sessionMessageSubscribers.has("default/main"), false);
});

test("gateway transcript surface reads agent-written transcript", async () => {
  await loadLearningPlugins();
  const state = createGatewayRuntimeState();
  const { entry } = await getOrCreateSession("default/transcript", {
    lastChannel: "gateway",
  });
  const run = launchGatewayAgentRun({
    state,
    message: "查看历史",
    sessionKey: "default/transcript",
    sessionId: entry.sessionId,
    runId: "gw-run-2",
  });
  await run.completion;
  const transcript = await loadGatewayTranscript(entry.sessionId, resolveGatewayAgentDataDir());
  assert.equal(transcript.length >= 2, true);
});
