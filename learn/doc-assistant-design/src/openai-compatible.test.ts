import assert from "node:assert/strict";
import test from "node:test";
import { answerWithOpenAICompatible } from "./openai-compatible.js";

void test("answerWithOpenAICompatible builds prompts from shared task frames and evidence labels", async (t) => {
  const originalFetch = globalThis.fetch;
  let capturedBody = "";
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async (_input, init) => {
    capturedBody = typeof init?.body === "string" ? init.body : "";
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Use `deleteMessageForAll` to recall the message.",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;

  await answerWithOpenAICompatible({
    config: {
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
    },
    question: "How to recall a message in web?",
    hits: [
      {
        path: "docs/chatsdk-web/message/recall.md",
        heading: "Delete a message",
        startLine: 8,
        endLine: 20,
        snippet: "Load the message and recall it for all participants.",
        text: "Call BaseChannel.createMessagesQuery(...) and channel.deleteMessageForAll(message).",
        score: 10,
      },
      {
        path: "docs/chatsdk-web/message/recall.md",
        heading: "Handle deletion notifications",
        startLine: 22,
        endLine: 35,
        snippet: "Update the UI after the recall event arrives.",
        text: "Register MessageHandler and handle onMessageDeleted to update the UI.",
        score: 9,
      },
      {
        path: "docs/platform-chat-api/message/delete.md",
        heading: "Delete message endpoint",
        startLine: 5,
        endLine: 15,
        snippet: "Use the Platform Chat API to delete a message on the server.",
        text: "Use the Platform Chat API message delete endpoint from your app server.",
        score: 8,
      },
    ],
  });

  const payload = JSON.parse(capturedBody) as {
    messages?: Array<{
      role?: string;
      content?: string;
    }>;
  };
  const userPrompt = payload.messages?.find((message) => message.role === "user")?.content ?? "";

  assert.equal(userPrompt.includes("Question frame: responseMode=procedure"), true);
  assert.equal(userPrompt.includes("platform=web"), true);
  assert.equal(userPrompt.includes("focus=message"), true);
  assert.equal(userPrompt.includes("procedure/message"), true);
  assert.equal(userPrompt.includes("event/message"), true);
  assert.equal(userPrompt.includes("server_only"), true);
});
