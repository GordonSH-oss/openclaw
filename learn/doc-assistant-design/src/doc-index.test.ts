import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDocIndex, isDocIndexFresh, rebuildDocIndexIfNeeded } from "./doc-index.js";

void test("doc index extracts heading chunks and skips archive directories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-index-root-"));
  await fs.mkdir(path.join(root, ".archive"), { recursive: true });
  await fs.writeFile(
    path.join(root, "guide.md"),
    "# Step 1\nInitialize the SDK.\n\n## Step 2\nSend a message.\n",
    "utf-8",
  );
  await fs.writeFile(path.join(root, ".archive", "ignored.md"), "# Ignored\n", "utf-8");

  const chunks = await buildDocIndex({ docsRoot: root, dataDir: root });
  assert.equal(
    chunks.some((chunk) => chunk.heading === "Step 1"),
    true,
  );
  assert.equal(
    chunks.some((chunk) => chunk.relativePath.includes(".archive")),
    false,
  );
});

void test("doc index cache freshness tracks docs changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-index-fresh-"));
  await fs.writeFile(path.join(root, "guide.md"), "# Guide\nOriginal.\n", "utf-8");

  await rebuildDocIndexIfNeeded({ docsRoot: root, dataDir: root });
  assert.equal(await isDocIndexFresh({ docsRoot: root, dataDir: root }), true);

  await fs.writeFile(path.join(root, "guide.md"), "# Guide\nUpdated.\n", "utf-8");
  assert.equal(await isDocIndexFresh({ docsRoot: root, dataDir: root }), false);
});
