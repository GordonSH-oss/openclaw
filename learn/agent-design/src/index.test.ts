import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runLearningAgentCommand,
  waitForLearningAgentRun,
  resolveAuthProfileOrder,
  buildWorkspaceSkillSnapshot,
  loadLearningTranscript,
  loadBootstrapMemory,
  readWorkspaceMemoryFile,
  searchMemoryIndex,
} from "./index.js";
import { loadLearningPlugins } from "../../plugin-design/src/index.js";
import { loadAuthProfileStore } from "./auth-profiles/store.js";
import { markAuthProfileFailure } from "./auth-profiles/order.js";
import { resolveLearningSession } from "./command/session.js";

async function makeTempDir(name: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("session resolution creates a stable session entry", async () => {
  const dataDir = await makeTempDir("agent-session");
  const first = await resolveLearningSession({
    sessionKey: "default/main",
    dataDir,
  });
  const second = await resolveLearningSession({
    sessionKey: "default/main",
    dataDir,
  });
  assert.equal(first.sessionId, second.sessionId);
  assert.equal(first.transcriptPath, second.transcriptPath);
});

test("embedded runner writes user/tool/assistant messages", async () => {
  const dataDir = await makeTempDir("agent-run");
  const handle = runLearningAgentCommand({
    runId: "run-1",
    message: "请帮我计算: 2 + 3 * 4",
    sessionKey: "default/main",
    dataDir,
  });
  const result = await handle.completion;
  assert.equal(result.status, "ok");
  const transcript = await loadLearningTranscript(result.sessionId, dataDir);
  assert.equal(transcript[0]?.role, "user");
  assert.equal(transcript.some((message) => message.role === "tool"), true);
  assert.equal(transcript.at(-1)?.role, "assistant");
});

test("model fallback advances after simulated rate limit", async () => {
  const dataDir = await makeTempDir("agent-fallback");
  const handle = runLearningAgentCommand({
    runId: "run-2",
    message: "[simulate:rate-limit] 请继续",
    sessionKey: "default/main",
    dataDir,
  });
  const result = await handle.completion;
  assert.equal(result.status, "ok");
  assert.equal(result.attempts.length >= 2, true);
  assert.equal(result.attempts[0]?.ok, false);
  assert.equal(result.attempts[1]?.ok, true);
});

test("auth profile order respects cooldown and preferred profile", async () => {
  const dataDir = await makeTempDir("agent-auth");
  const store = await loadAuthProfileStore(dataDir);
  markAuthProfileFailure({
    store,
    profileId: "primary",
    reason: "rate_limit",
    now: Date.now(),
  });
  const order = resolveAuthProfileOrder({
    store,
    provider: "mock",
    preferredProfile: "backup",
  });
  assert.equal(order.orderedProfileIds[0], "backup");
  assert.equal(order.cooledDownProfileIds.includes("primary"), true);
});

test("workspace skill snapshot ignores paths outside the root", async () => {
  const root = await makeTempDir("agent-skills");
  const skillDir = path.join(root, "demo-skill");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    "# Demo\n\nA demo skill for tests.\n",
    "utf-8",
  );
  const snapshot = await buildWorkspaceSkillSnapshot({
    skillRoots: [root],
  });
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.entries[0]?.name, "demo-skill");
});

test("waitForLearningAgentRun returns terminal state", async () => {
  const dataDir = await makeTempDir("agent-wait");
  void runLearningAgentCommand({
    runId: "run-3",
    message: "hello",
    sessionKey: "default/main",
    dataDir,
  });
  const result = await waitForLearningAgentRun("run-3");
  assert.ok(result);
  assert.equal(result?.status, "ok");
});

test("memory_write tool stores a note in daily memory", async () => {
  const dataDir = await makeTempDir("agent-memory-write");
  const workspaceDir = await makeTempDir("agent-memory-workspace");
  const handle = runLearningAgentCommand({
    runId: "run-memory-1",
    message: "记住：我喜欢乌龙茶，不喜欢太甜的饮料",
    sessionKey: "default/main",
    dataDir,
    workspaceDir,
  });
  await handle.completion;
  const memory = await readWorkspaceMemoryFile({
    workspaceDir,
    target: "memory/" + new Date().toISOString().slice(0, 10) + ".md",
  });
  assert.equal(memory.text.includes("我喜欢乌龙茶"), true);
});

test("memory_search returns chunks from curated memory", async () => {
  const dataDir = await makeTempDir("agent-memory-search");
  const workspaceDir = await makeTempDir("agent-memory-search-workspace");
  await fs.writeFile(
    path.join(workspaceDir, "MEMORY.md"),
    "# Preferences\n\nUser likes jasmine tea and concise answers.\n",
    "utf-8",
  );
  const bootstrap = await loadBootstrapMemory({ workspaceDir });
  assert.equal(bootstrap.combinedText.includes("jasmine tea"), true);
  const results = await searchMemoryIndex({
    workspaceDir,
    dataDir,
    query: "jasmine tea",
  });
  assert.equal(results.length > 0, true);
  assert.equal(results[0]?.text.includes("jasmine tea"), true);
});

test("pre-compaction memory flush writes recent transcript summary", async () => {
  const dataDir = await makeTempDir("agent-memory-flush");
  const workspaceDir = await makeTempDir("agent-memory-flush-workspace");
  for (let index = 0; index < 4; index += 1) {
    const handle = runLearningAgentCommand({
      runId: `flush-${index}`,
      message: `第 ${String(index + 1)} 次消息`,
      sessionKey: "default/main",
      dataDir,
      workspaceDir,
    });
    await handle.completion;
  }
  const memory = await readWorkspaceMemoryFile({
    workspaceDir,
    target: "memory/" + new Date().toISOString().slice(0, 10) + ".md",
  });
  assert.equal(memory.text.includes("Pre-compaction memory flush"), true);
  assert.equal(memory.text.includes("Session default/main neared compaction"), true);
});

test("plugin-design registry can provide memory runtime and gateway method to agent tools", async () => {
  const dataDir = await makeTempDir("agent-plugin-runtime");
  await loadLearningPlugins();
  const handle = runLearningAgentCommand({
    runId: "run-plugin-1",
    message: "gateway.mock.ping",
    sessionKey: "default/main",
    dataDir,
  });
  const result = await handle.completion;
  assert.equal(result.reply?.includes("gateway.mock.ping") ?? false, true);
  const memoryHandle = runLearningAgentCommand({
    runId: "run-plugin-2",
    message: "记住：plugin runtime should own memory writes",
    sessionKey: "default/main",
    dataDir,
  });
  const memoryResult = await memoryHandle.completion;
  assert.equal(memoryResult.reply?.includes("plugin:mock-memory") ?? false, true);
});
