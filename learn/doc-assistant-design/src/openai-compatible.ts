import { detectAnswerLanguage } from "./answer-language.js";
import type { DocCitation, DocSearchHit, OpenAICompatibleConfig } from "./protocol/index.js";

type ChatCompletionMessage = {
  content?: string | Array<{ type?: string; text?: string }>;
};

type ChatCompletionChoice = {
  message?: {
    content?: ChatCompletionMessage["content"];
  };
};

type ChatCompletionResponse = {
  choices?: ChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

function joinUrl(baseURL: string, pathname: string): string {
  return `${baseURL.replace(/\/+$/, "")}${pathname}`;
}

function extractTextContent(content: ChatCompletionMessage["content"]): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function renderSourcesAppendix(citations: DocCitation[]): string {
  if (citations.length === 0) {
    return "Sources:\n- none";
  }
  return [
    "Sources:",
    ...citations.map((citation) => {
      const heading = citation.heading ? `#${citation.heading}` : "";
      return `- ${citation.path}${heading}:${citation.startLine}-${citation.endLine}`;
    }),
  ].join("\n");
}

function normalizePromptText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bdms?\b/g, "direct channel")
    .replace(/\bdirect messages?\b/g, "direct channel")
    .replace(/\bdirect chats?\b/g, "direct channel")
    .replace(/\bprivate chats?\b/g, "direct channel")
    .replace(/\bjavascript\b/g, "web")
    .replace(/\bjs\b/g, "web");
}

function detectEvidencePlatform(hit: DocSearchHit): string {
  const normalized = normalizePromptText([hit.path, hit.heading ?? "", hit.text].join("\n"));
  if (normalized.includes("android")) {
    return "android";
  }
  if (normalized.includes("ios")) {
    return "ios";
  }
  if (normalized.includes("web")) {
    return "web";
  }
  return "general";
}

function detectEvidenceRole(hit: DocSearchHit): string {
  const normalized = normalizePromptText([hit.path, hit.heading ?? "", hit.text].join("\n"));
  if (normalized.includes("platform chat api") || normalized.includes("server api")) {
    return "server_irrelevant";
  }
  if (normalized.includes("send your first message") || normalized.includes("send a message")) {
    return "send_first_message";
  }
  if (normalized.includes("connect") || normalized.includes("token")) {
    return "connect";
  }
  if (
    normalized.includes("import") ||
    normalized.includes("initialize") ||
    normalized.includes("quickstart") ||
    normalized.includes("get started")
  ) {
    return "setup";
  }
  if (normalized.includes("direct channel") || normalized.includes("channel overview")) {
    return "start_chat";
  }
  return "reference";
}

function buildPrompt(question: string, hits: DocSearchHit[]): string {
  const language = detectAnswerLanguage(question, hits);
  const grouped = hits.slice(0, 6).reduce<Map<string, DocSearchHit[]>>((acc, hit) => {
    const key = `${detectEvidencePlatform(hit)}/${detectEvidenceRole(hit)}`;
    const current = acc.get(key) ?? [];
    current.push(hit);
    acc.set(key, current);
    return acc;
  }, new Map());

  const evidence = Array.from(grouped.entries())
    .map(([group, groupHits]) =>
      [
        `Evidence group: ${group}`,
        ...groupHits.map(
          (hit, index) =>
            [
              `Source ${index + 1}`,
              `Path: ${hit.path}`,
              `Heading: ${hit.heading ?? "(none)"}`,
              `Lines: ${hit.startLine}-${hit.endLine}`,
              `Snippet: ${hit.snippet}`,
            ].join("\n"),
        ),
      ].join("\n\n"),
    )
    .join("\n\n---\n\n");

  return [
    `Question: ${question}`,
    "",
    "Retrieved documentation:",
    evidence,
    "",
    language === "en" ? "Answer in English." : "Answer in Chinese.",
    "Only use the retrieved documentation.",
    "If the evidence is insufficient, say so clearly.",
    "Write a developer-helpful guide, not a search report.",
    "If the question depends on platform and the evidence spans multiple platforms while the user did not specify one, ask a follow-up question instead of guessing.",
    language === "en"
      ? "Prefer these sections when the evidence supports them: What you need, Steps, Key APIs or docs, Notes, Sources."
      : "Prefer these sections when the evidence supports them: 准备工作, 步骤, 关键 API / 文档, 注意事项, Sources.",
    "Include inline citations like [path:start-end].",
    "End with a Sources section that lists the cited paths.",
  ].join("\n");
}

export async function answerWithOpenAICompatible(params: {
  config: OpenAICompatibleConfig;
  question: string;
  hits: DocSearchHit[];
  onDelta?: (data: { text: string; delta: string }) => void;
}): Promise<{
  answer: string;
  selectedModel: string;
  selectedProvider: string;
}> {
  const citations = params.hits.map((hit) => ({
    path: hit.path,
    heading: hit.heading,
    startLine: hit.startLine,
    endLine: hit.endLine,
    snippet: hit.snippet,
  }));
  const model = params.config.model ?? "gpt-4.1-mini";
  const response = await fetch(joinUrl(params.config.baseURL, "/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You are a technical documentation assistant. Answer only from the provided evidence. Do not invent APIs, fields, or behavior.",
        },
        {
          role: "user",
          content: buildPrompt(params.question, params.hits),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI-compatible request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const text = extractTextContent(payload.choices?.[0]?.message?.content);
  if (!text) {
    throw new Error("OpenAI-compatible response did not contain answer text");
  }

  const answer = text.includes("Sources:")
    ? text
    : `${text.trim()}\n\n${renderSourcesAppendix(citations)}`;
  params.onDelta?.({
    text: answer,
    delta: answer,
  });

  return {
    answer,
    selectedModel: model,
    selectedProvider: "openai-compatible",
  };
}
