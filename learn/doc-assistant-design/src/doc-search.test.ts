import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DocIndexChunk } from "./doc-index.js";
import { searchDocs, searchDocsForBucket } from "./doc-search.js";

async function makeTempDir(name: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

function makeChunk(params: {
  id: string;
  relativePath: string;
  heading: string;
  text: string;
  tokens: string[];
}): DocIndexChunk {
  return {
    id: params.id,
    relativePath: params.relativePath,
    heading: params.heading,
    startLine: 1,
    endLine: 5,
    text: params.text,
    tokens: params.tokens,
  };
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

void test("searchDocsForBucket gives concept overview docs a clear score lead over create and event pages", () => {
  const hits = searchDocsForBucket({
    chunks: [
      makeChunk({
        id: "overview",
        relativePath: "docs/chatsdk-web/community-channels/overview.md",
        heading: "Community channel overview",
        text: "A community channel is a large-scale channel that organizes members into subchannels.",
        tokens: ["community", "channel", "overview", "large", "scale", "subchannels", "members"],
      }),
      makeChunk({
        id: "create",
        relativePath: "docs/chatsdk-web/community-channels/creating-channel.md",
        heading: "Create a community channel",
        text: "Create a community channel and configure subchannels.",
        tokens: ["create", "community", "channel", "configure", "subchannels"],
      }),
      makeChunk({
        id: "events",
        relativePath: "docs/chatsdk-web/community-channels/events.md",
        heading: "Community channel events",
        text: "Listen for channel and membership events in community channels.",
        tokens: ["community", "channel", "events", "membership", "listen"],
      }),
    ],
    question: "What is a community channel?",
    bucket: "concept",
    limit: 5,
  });

  assert.equal(hits[0]?.path, "docs/chatsdk-web/community-channels/overview.md");
  assert.equal(hits[1]?.path, "docs/chatsdk-web/community-channels/creating-channel.md");
  assert.equal(hits[2]?.path, "docs/chatsdk-web/community-channels/events.md");
  assert.equal(hits[0].score > hits[1].score, true);
  assert.equal(hits[1].score > hits[2].score, true);
  assert.equal(hits[0].score - hits[1].score >= 40, true);
});

void test("searchDocsForBucket strongly boosts must-cover push notification language matches", () => {
  const hits = searchDocsForBucket({
    chunks: [
      makeChunk({
        id: "locale-guide",
        relativePath: "docs/chatsdk-android/push/set-push-language.md",
        heading: "Set the default language for push notification templates",
        text: "Configure the default language and locale for push notification delivery.",
        tokens: ["set", "default", "language", "locale", "push", "notification", "delivery"],
      }),
      makeChunk({
        id: "style-guide",
        relativePath: "docs/chatsdk-android/push/config-push-notification-style.md",
        heading: "Configure push notification style",
        text: "Customize icons and appearance for push notification banners.",
        tokens: ["configure", "push", "notification", "style", "icons", "appearance"],
      }),
      makeChunk({
        id: "generic-push",
        relativePath: "docs/chatsdk-android/push/handle-push-notification-click.md",
        heading: "Handle push notification click events",
        text: "Implement the default navigation behavior when the user taps a push notification.",
        tokens: ["handle", "push", "notification", "click", "events", "navigation"],
      }),
    ],
    question: "How do I set the default language for push notification on Android?",
    bucket: "procedural",
    limit: 5,
  });

  assert.equal(hits[0]?.path, "docs/chatsdk-android/push/set-push-language.md");
  assert.equal(hits[1]?.path, "docs/chatsdk-android/push/config-push-notification-style.md");
  assert.equal(hits[0].score - hits[1].score >= 200, true);
  assert.equal(hits[1].score > hits[2].score, true);
});

void test("searchDocsForBucket prefers exact send-intent headings over generic or body-only matches", () => {
  const hits = searchDocsForBucket({
    chunks: [
      makeChunk({
        id: "heading-win",
        relativePath: "docs/chatsdk-web/guides/guide-a.md",
        heading: "Send a targeted message",
        text: "Use directedUserIds to deliver a message to selected users.",
        tokens: ["send", "targeted", "message", "directeduserids", "selected", "users"],
      }),
      makeChunk({
        id: "generic",
        relativePath: "docs/chatsdk-web/guides/guide-c.md",
        heading: "Send a message",
        text: "Call channel.sendMessage with regular params.",
        tokens: ["send", "message", "regular", "params"],
      }),
      makeChunk({
        id: "body-only",
        relativePath: "docs/chatsdk-web/guides/guide-b.md",
        heading: "Message options",
        text: "To send a targeted message, use directedUserIds for selected recipients.",
        tokens: [
          "message",
          "options",
          "send",
          "targeted",
          "message",
          "directeduserids",
          "selected",
          "recipients",
        ],
      }),
    ],
    question: "How to send a targeted message?",
    bucket: "procedural",
    limit: 5,
  });

  assert.equal(hits[0]?.path, "docs/chatsdk-web/guides/guide-a.md");
  assert.equal(hits[1]?.path, "docs/chatsdk-web/guides/guide-c.md");
  assert.equal(hits[2]?.path, "docs/chatsdk-web/guides/guide-b.md");
  assert.equal(hits[0].score > hits[1].score, true);
  assert.equal(hits[1].score > hits[2].score, true);
});
