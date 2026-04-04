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

void test("searchDocs prefers direct-channel overview over maintenance pages for iOS creation questions", async () => {
  const docsRoot = await makeTempDir("doc-search-ios-direct-channel-creation");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-ios", "direct-system-channels"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "direct-system-channels", "overview.md"),
    [
      "# Channel overview",
      "",
      "## Create or get a channel instance",
      "",
      'Create `DirectChannel(channelId: "userId")` as the iOS direct channel instance.',
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "direct-system-channels", "deleting-channel.md"),
    [
      "# Delete a single channel",
      "",
      'Call `channel.delete()` after creating `DirectChannel(channelId: "userId")`.',
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "direct-system-channels", "pinning-channel.md"),
    [
      "# Pin a channel",
      "",
      'Call `channel.pin()` on `DirectChannel(channelId: "userId")`.',
      "",
    ].join("\n"),
    "utf-8",
  );

  const hits = await searchDocs({
    query: "How to create a direct channel on iOS?",
    docsRoot,
    maxResults: 4,
  });

  assert.equal(hits[0]?.path.endsWith("docs/chatsdk-ios/direct-system-channels/overview.md"), true);
  assert.equal(
    hits.some((hit) => hit.path.endsWith("deleting-channel.md")),
    true,
  );
  assert.equal(
    hits.some((hit) => hit.path.endsWith("pinning-channel.md")),
    true,
  );
});

void test("searchDocs prefers active leave docs over event and metadata noise for open-channel end questions", async () => {
  const docsRoot = await makeTempDir("doc-search-ios-open-channel-end");
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-ios", "open-channels"), {
    recursive: true,
  });
  await fs.mkdir(path.join(docsRoot, "docs", "chatsdk-ios", "event-delegation"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "open-channels", "leaving-channel.md"),
    [
      "# Leave an open channel",
      "",
      "Participants can leave an open channel in two ways:",
      "",
      "- Passive removal: the server removes offline participants automatically.",
      "- Active leave: the participant explicitly exits via the SDK.",
      "",
      "## Passive removal",
      "",
      "Open channels use an auto-removal mechanism for offline participants.",
      "",
      "## Active leave",
      "",
      'Create `OpenChannel(channelId: "channelId")`, then call `exitChannel(...)` to leave it.',
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "open-channels", "platform-config.md"),
    [
      "# Open channel service configuration",
      "",
      "## Feature configuration",
      "",
      "Subscribe to webhook events when channels are created, destroyed, or when participants join or leave.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "open-channels", "managing-metadata.md"),
    [
      "# Manage open channel metadata",
      "",
      "## Delete metadata",
      "",
      "Use `OpenChannelDeleteMetadataParams` to remove one or more metadata keys from the open channel.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(docsRoot, "docs", "chatsdk-ios", "event-delegation", "open-channel-delegation.md"),
    [
      "# Open channel events",
      "",
      "Use `OpenChannelHandler` to receive lifecycle and metadata events from open channels.",
      "",
      "## Enter and exit events",
      "",
      "Adopt `NCOpenChannelHandler` to observe open channel enter and exit events.",
      "",
      "When the channel is destroyed, `onChannelDestroyed(...)` fires.",
      "",
    ].join("\n"),
    "utf-8",
  );

  const hits = await searchDocs({
    query: "How to destroy an open channel on iOS?",
    docsRoot,
    maxResults: 6,
  });

  assert.equal(hits[0]?.path.endsWith("docs/chatsdk-ios/open-channels/leaving-channel.md"), true);
  assert.equal(hits[0]?.heading, "Active leave");
  assert.equal(
    hits.findIndex(
      (hit) =>
        hit.path.endsWith("docs/chatsdk-ios/open-channels/leaving-channel.md") &&
        hit.heading === "Active leave",
    ) <
      hits.findIndex((hit) =>
        hit.path.endsWith("docs/chatsdk-ios/open-channels/managing-metadata.md"),
      ),
    true,
  );
  assert.equal(
    hits.findIndex(
      (hit) =>
        hit.path.endsWith("docs/chatsdk-ios/open-channels/leaving-channel.md") &&
        hit.heading === "Active leave",
    ) <
      hits.findIndex((hit) =>
        hit.path.endsWith("docs/chatsdk-ios/event-delegation/open-channel-delegation.md"),
      ),
    true,
  );
});
