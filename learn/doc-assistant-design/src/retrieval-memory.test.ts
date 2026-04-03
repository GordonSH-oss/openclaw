import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DocIndexChunk } from "./doc-index.js";
import { searchDocsForBucket } from "./doc-search.js";
import { findRetrievalMemoryMatch, saveRetrievalMemoryEntries } from "./retrieval-memory.js";

void test("retrieval memory matches normalized question patterns", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-retrieval-memory-"));
  await saveRetrievalMemoryEntries(
    [
      {
        entryId: "entry-1",
        questionPattern: "How to send a targeted message?",
        normalizedQuestionPattern: "how to send a targeted message",
        preferredPaths: ["docs/chatsdk-web/group-channel/direct"],
        discouragedPaths: ["docs/platform-chat-api"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: "manual",
      },
    ],
    dataDir,
  );

  const match = await findRetrievalMemoryMatch({
    question: "How do I send a targeted message?",
    dataDir,
  });
  assert.ok(match);
  assert.equal(match?.entry.preferredPaths[0], "docs/chatsdk-web/group-channel/direct");
});

void test("searchDocsForBucket applies preferred and discouraged path overrides", () => {
  const chunks: DocIndexChunk[] = [
    {
      id: "preferred",
      relativePath: "docs/chatsdk-web/group-channel/direct.md",
      heading: "Send a targeted message",
      startLine: 1,
      endLine: 5,
      text: "Use directedUserIds to send a targeted message.",
      tokens: ["send", "targeted", "message", "directeduserids"],
    },
    {
      id: "discouraged",
      relativePath: "docs/platform-chat-api/message/send-group.md",
      heading: "Send a message",
      startLine: 1,
      endLine: 5,
      text: "Server API group message endpoint.",
      tokens: ["send", "message", "server", "api"],
    },
  ];

  const hits = searchDocsForBucket({
    chunks,
    question: "How to send a targeted message?",
    bucket: "procedural",
    limit: 2,
    overrides: {
      preferredPaths: ["docs/chatsdk-web/group-channel/direct"],
      discouragedPaths: ["docs/platform-chat-api"],
    },
  });

  assert.equal(hits[0]?.path, "docs/chatsdk-web/group-channel/direct.md");
});
