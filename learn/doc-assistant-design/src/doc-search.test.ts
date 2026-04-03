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

void test("searchDocs prefers direct-channel docs over send-message docs for direct-channel creation", async () => {
  const docsRoot = await makeTempDir("doc-search-direct-channel-creation");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-web", "direct-system-channels"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-web", "message"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-web", "direct-system-channels", "overview.md"),
    [
      "# Direct channel overview",
      "",
      "A direct channel enables one-to-one messaging between two users on Web.",
      "",
      "## Create a channel instance",
      "",
      "Create `DirectChannel('<target-user-id>')` as the Web direct channel instance.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-web", "message", "send.md"),
    [
      "# Send a text message",
      "",
      "Create `DirectChannel('<target-user-id>')`, then build `SendTextMessageParams` and call `channel.sendMessage(...)`.",
      "",
    ].join("\n"),
    "utf-8",
  );

  const hits = await searchDocs({
    query: "How to create a direct channel on Web?",
    docsRoot,
    maxResults: 4,
  });

  const directIndex = hits.findIndex((hit) =>
    hit.path.endsWith("docs/chatsdk-web/direct-system-channels/overview.md"),
  );
  const sendIndex = hits.findIndex((hit) => hit.path.endsWith("docs/chatsdk-web/message/send.md"));

  assert.equal(directIndex !== -1, true);
  assert.equal(sendIndex !== -1, true);
  assert.equal(directIndex < sendIndex, true);
  assert.equal(hits[0]?.path.endsWith("docs/chatsdk-web/direct-system-channels/overview.md"), true);
});
