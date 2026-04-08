import assert from "node:assert/strict";
import test from "node:test";
import {
  answerWithOpenAICompatible,
  detectFollowUpRewriteWithOpenAICompatible,
  OpenAICompatibleAnswerError,
} from "./openai-compatible.js";

function resolveFetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

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
  assert.equal(
    userPrompt.includes(
      "Use numbered lists for executable Steps. Reserve bullets for notes or key points.",
    ),
    true,
  );
});

void test("answerWithOpenAICompatible accepts object-shaped message content", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: {
                text: "Use `sendMessage` to send the message.",
              },
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

  const result = await answerWithOpenAICompatible({
    config: {
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
    },
    question: "How to send a message on iOS?",
    hits: [
      {
        path: "docs/chatsdk-ios/message/send.md",
        heading: "Send a regular message",
        startLine: 28,
        endLine: 100,
        snippet: "Build SendMessageParams and call sendMessage.",
        text: "Build SendMessageParams and call sendMessage.",
        score: 10,
      },
    ],
  });

  assert.equal(result.selectedProvider, "openai-compatible");
  assert.equal(result.selectedModel, "gpt-test");
  assert.equal(result.answer.includes("Use `sendMessage` to send the message."), true);
  assert.equal(result.answer.includes("Sources:"), true);
});

void test("answerWithOpenAICompatible retries once when the provider returns empty content", async (t) => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () => {
    callCount += 1;
    return new Response(
      JSON.stringify(
        callCount === 1
          ? {
              choices: [
                {
                  message: {
                    content: null,
                    reasoning_content: null,
                    tool_calls: null,
                  },
                },
              ],
            }
          : {
              choices: [
                {
                  message: {
                    content: "Use `sendMessage` after building the params.",
                  },
                },
              ],
            },
      ),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;

  const result = await answerWithOpenAICompatible({
    config: {
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
    },
    question: "How to send a message on Android?",
    hits: [
      {
        path: "docs/chatsdk-android/message/send.md",
        heading: "Send a text message",
        startLine: 67,
        endLine: 143,
        snippet: "Build SendTextMessageParams and call channel.sendMessage.",
        text: "Build SendTextMessageParams and call channel.sendMessage.",
        score: 10,
      },
    ],
  });

  assert.equal(callCount, 2);
  assert.equal(result.answer.includes("Use `sendMessage` after building the params."), true);
});

void test("answerWithOpenAICompatible falls back to responses when chat completions stay empty", async (t) => {
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async (input) => {
    const url = resolveFetchInputUrl(input);
    paths.push(new URL(url).pathname);
    if (url.endsWith("/chat/completions")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return new Response(
      JSON.stringify({
        output_text: "Use `sendMessage` after building the params.",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;

  const result = await answerWithOpenAICompatible({
    config: {
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
    },
    question: "How to send a message on Android?",
    hits: [
      {
        path: "docs/chatsdk-android/message/send.md",
        heading: "Send a text message",
        startLine: 67,
        endLine: 143,
        snippet: "Build SendTextMessageParams and call channel.sendMessage.",
        text: "Build SendTextMessageParams and call channel.sendMessage.",
        score: 10,
      },
    ],
  });

  assert.deepEqual(paths, ["/v1/chat/completions", "/v1/chat/completions", "/v1/responses"]);
  assert.equal(result.answer.includes("Use `sendMessage` after building the params."), true);
});

void test("detectFollowUpRewriteWithOpenAICompatible returns a rewritten standalone question", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_rewrite: true,
                rewritten_question: "How to pin a channel on iOS? Show an example.",
                reason: "The latest turn depends on the prior topic.",
              }),
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

  const rewritten = await detectFollowUpRewriteWithOpenAICompatible({
    config: {
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
    },
    previousQuestion: "How to pin a channel on iOS?",
    currentQuestion: "Could you also show the example for that one?",
  });

  assert.equal(rewritten, "How to pin a channel on iOS? Show an example.");
});

void test("answerWithOpenAICompatible preserves empty-output payloads across chat and responses fallbacks", async (t) => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async (input) => {
    callCount += 1;
    const url = resolveFetchInputUrl(input);
    return new Response(
      JSON.stringify({
        request_id: `req-${callCount}`,
        ...(url.endsWith("/responses")
          ? {
              output_text: null,
              output: [],
            }
          : {
              choices: [
                {
                  message: {
                    content: null,
                  },
                },
              ],
            }),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;

  await assert.rejects(
    answerWithOpenAICompatible({
      config: {
        baseURL: "https://example.com/v1",
        apiKey: "test-key",
        model: "gpt-test",
      },
      question: "How to send a message on Android?",
      hits: [
        {
          path: "docs/chatsdk-android/message/send.md",
          heading: "Send a text message",
          startLine: 67,
          endLine: 143,
          snippet: "Build SendTextMessageParams and call channel.sendMessage.",
          text: "Build SendTextMessageParams and call channel.sendMessage.",
          score: 10,
        },
      ],
    }),
    (error: unknown) => {
      assert.equal(callCount, 3);
      assert.equal(error instanceof OpenAICompatibleAnswerError, true);
      assert.equal((error as OpenAICompatibleAnswerError).code, "empty_output");
      assert.equal(
        String((error as OpenAICompatibleAnswerError).rawAnswer).includes("chat attempt 1:"),
        true,
      );
      assert.equal(
        String((error as OpenAICompatibleAnswerError).rawAnswer).includes('"request_id":"req-3"'),
        true,
      );
      assert.equal(
        String((error as OpenAICompatibleAnswerError).rawAnswer).includes("responses fallback:"),
        true,
      );
      return true;
    },
  );
});
