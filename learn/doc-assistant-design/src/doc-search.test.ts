import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { searchDocs } from "./doc-search.js";

async function makeTempDir(name: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

void test("searchDocs drops off-intent infra queries when docs have no coverage tokens", async () => {
  const docsRoot = await makeTempDir("doc-search-off-intent");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-ios", "quickstart"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "quickstart", "connect.md"),
    [
      "# Connect",
      "",
      "Initialize the Chat SDK and connect the current user with an access token.",
      "",
    ].join("\n"),
    "utf-8",
  );

  const hits = await searchDocs({
    query: "How do I configure Kubernetes liveness probes for this SDK?",
    docsRoot,
    maxResults: 5,
  });

  assert.equal(hits.length, 0);
});
