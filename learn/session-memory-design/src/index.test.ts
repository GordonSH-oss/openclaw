import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  appendLearningDailyMemoryEntry,
  appendLearningTranscriptMessage,
  buildLearningMemoryIndex,
  createLearningSessionEventHub,
  createLearningSessionLifecycle,
  flushLearningSessionMemory,
  loadLearningTranscript,
  readLearningMemoryFile,
  resolveLearningSession,
  runLearningSessionMaintenance,
  searchLearningMemory,
} from "./index.js";

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "learning-session-memory-"));
}

test("session resolution creates stable entries and transcript remains append-only", async () => {
  const dataDir = await createTempDir();
  const entry = await resolveLearningSession({
    sessionKey: "agent:main:main",
    dataDir,
  });
  await appendLearningTranscriptMessage({
    sessionId: entry.sessionId,
    dataDir,
    message: { role: "user", content: "hello", timestamp: Date.now() },
  });
  await appendLearningTranscriptMessage({
    sessionId: entry.sessionId,
    dataDir,
    message: { role: "assistant", content: "world", timestamp: Date.now() },
  });
  const transcript = await loadLearningTranscript(entry.sessionId, dataDir);
  assert.equal(transcript.length, 2);
  assert.equal(transcript[1]?.parentId, transcript[0]?.id);
});

test("session lifecycle emits events", async () => {
  const dataDir = await createTempDir();
  const hub = createLearningSessionEventHub();
  const events: string[] = [];
  hub.subscribe((event) => events.push(event.type));
  await createLearningSessionLifecycle({
    sessionKey: "agent:main:main",
    dataDir,
    events: hub,
  });
  assert.deepEqual(events, ["sessions.changed"]);
});

test("maintenance prunes stale sessions and rotates large transcripts", async () => {
  const dataDir = await createTempDir();
  const stale = await resolveLearningSession({
    sessionKey: "agent:main:stale",
    dataDir,
    initial: { updatedAt: 1, createdAt: 1 },
  });
  const active = await resolveLearningSession({
    sessionKey: "agent:main:active",
    dataDir,
  });
  await appendLearningTranscriptMessage({
    sessionId: active.sessionId,
    dataDir,
    message: { role: "user", content: "x".repeat(200), timestamp: Date.now() },
  });
  const result = await runLearningSessionMaintenance({
    dataDir,
    staleBeforeTs: Date.now() - 60_000,
    maxEntries: 1,
    rotateTranscriptBytes: 32,
  });
  assert.equal(result.prunedKeys.includes("agent:main:stale"), true);
  assert.equal(result.rotatedSessionIds.includes(active.sessionId), true);
  assert.equal(await fs.stat(`${active.transcriptPath}.rotated`).then(() => true, () => false), true);
  await fs.rm(stale.transcriptPath, { force: true });
});

test("memory_get gracefully handles missing files and search indexes curated + daily memory", async () => {
  const workspaceDir = await createTempDir();
  await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Profile\n\nLikes routing diagrams", "utf-8");
  await appendLearningDailyMemoryEntry({
    workspaceDir,
    note: "Remember to explain plugin registry",
    source: "manual",
  });
  const missing = await readLearningMemoryFile({
    workspaceDir,
    target: "memory/2099-01-01.md",
  });
  const chunks = await buildLearningMemoryIndex({ workspaceDir, dataDir: workspaceDir });
  const results = await searchLearningMemory({
    workspaceDir,
    dataDir: workspaceDir,
    query: "routing plugin",
  });
  assert.equal(missing.text, "");
  assert.equal(chunks.length >= 2, true);
  assert.equal(results.length >= 1, true);
});

test("flush writes durable notes once per transcript tail", async () => {
  const workspaceDir = await createTempDir();
  const transcript = Array.from({ length: 6 }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message-${index}`,
    timestamp: Date.now() + index,
  })) as Awaited<ReturnType<typeof loadLearningTranscript>>;
  const first = await flushLearningSessionMemory({
    workspaceDir,
    sessionKey: "agent:main:main",
    transcript,
  });
  const second = await flushLearningSessionMemory({
    workspaceDir,
    sessionKey: "agent:main:main",
    transcript,
  });
  assert.equal(first.flushed, true);
  assert.equal(second.path, first.path);
  const content = await fs.readFile(first.path!, "utf-8");
  assert.equal(content.includes("memory-flush:agent:main:main:m-5"), true);
});
