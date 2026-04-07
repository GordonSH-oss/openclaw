import { detectAnswerLanguage } from "./answer-language.js";
import type { DocCitation, DocSearchHit, OpenAICompatibleConfig } from "./protocol/index.js";
import { detectQuestionPlatform } from "./question-state.js";
import { buildTaskFrame, labelEvidenceHit, type TaskFrame } from "./task-frame.js";

export const DEFAULT_DOC_ASSISTANT_AGENT_MODEL = "gpt-5.4";

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

function detectEvidencePlatform(hit: DocSearchHit): string {
  return detectQuestionPlatform([hit.path, hit.heading ?? "", hit.text].join("\n")) ?? "general";
}

function summarizeTaskFrame(frame: TaskFrame): string {
  return [
    `responseMode=${frame.responseMode}`,
    frame.platform ? `platform=${frame.platform}` : "",
    frame.channelKind ? `channelKind=${frame.channelKind}` : "",
    frame.apiLayer ? `apiLayer=${frame.apiLayer}` : "",
    frame.anchors.focus.length > 0 ? `focus=${frame.anchors.focus.join("|")}` : "",
    frame.anchors.constraints.length > 0
      ? `constraints=${frame.anchors.constraints.join("|")}`
      : "",
    frame.anchors.apiSymbols.length > 0 ? `apiSymbols=${frame.anchors.apiSymbols.join("|")}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function pickPrimaryEvidenceLabel(params: {
  frame: TaskFrame;
  labels: ReturnType<typeof labelEvidenceHit>["labels"];
}): string {
  const { frame, labels } = params;
  if (frame.responseMode === "definition" && labels.includes("definition")) {
    return "definition";
  }
  if (frame.responseMode === "procedure") {
    if (labels.includes("event")) {
      return "event";
    }
    if (labels.includes("procedure")) {
      return "procedure";
    }
  }
  for (const label of [
    "setup",
    "connect",
    "navigate",
    "procedure",
    "event",
    "overview",
    "definition",
    "reference",
  ] as const) {
    if (labels.includes(label)) {
      return label;
    }
  }
  return "reference";
}

function detectEvidenceGroupKey(params: { frame: TaskFrame; hit: DocSearchHit }): string {
  const descriptor = labelEvidenceHit(params.hit);
  const parts = [detectEvidencePlatform(params.hit)];
  if (descriptor.labels.includes("server_only")) {
    parts.push("server_only");
  } else if (descriptor.labels.includes("client_only")) {
    parts.push("client_only");
  }
  parts.push(
    pickPrimaryEvidenceLabel({
      frame: params.frame,
      labels: descriptor.labels,
    }),
  );
  const anchorGroup = descriptor.anchors.nounPhrases[0] ?? descriptor.anchors.apiSymbols[0];
  if (anchorGroup) {
    parts.push(anchorGroup);
  }
  return parts.join("/");
}

function buildPrompt(question: string, hits: DocSearchHit[]): string {
  const language = detectAnswerLanguage(question, hits);
  const frame = buildTaskFrame({
    question,
    hits,
  });
  const grouped = hits.slice(0, 6).reduce<Map<string, DocSearchHit[]>>((acc, hit) => {
    const key = detectEvidenceGroupKey({
      frame,
      hit,
    });
    const current = acc.get(key) ?? [];
    current.push(hit);
    acc.set(key, current);
    return acc;
  }, new Map());

  const evidence = Array.from(grouped.entries())
    .map(([group, groupHits]) =>
      [
        `Evidence group: ${group}`,
        ...groupHits.map((hit, index) =>
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
    `Question frame: ${summarizeTaskFrame(frame)}`,
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

function isLikelyPromptScaffoldingEcho(text: string): boolean {
  const normalized = text.toLowerCase();
  let matches = 0;
  for (const marker of [
    "question:",
    "retrieved documentation:",
    "only use the retrieved documentation.",
    "write a developer-helpful guide, not a search report.",
    "include inline citations like [path:start-end].",
  ]) {
    if (normalized.includes(marker)) {
      matches += 1;
    }
  }
  return matches >= 3;
}

export async function answerWithOpenAICompatible(params: {
  config: OpenAICompatibleConfig;
  question: string;
  hits: DocSearchHit[];
  prompt?: string;
  citations?: DocCitation[];
  onDelta?: (data: { text: string; delta: string }) => void;
}): Promise<{
  answer: string;
  selectedModel: string;
  selectedProvider: string;
}> {
  const citations =
    params.citations ??
    params.hits.map((hit) => ({
      path: hit.path,
      heading: hit.heading,
      startLine: hit.startLine,
      endLine: hit.endLine,
      snippet: hit.snippet,
    }));
  const prompt = params.prompt ?? buildPrompt(params.question, params.hits);
  const model = params.config.model ?? DEFAULT_DOC_ASSISTANT_AGENT_MODEL;
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
          content: prompt,
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
  if (isLikelyPromptScaffoldingEcho(text)) {
    throw new Error("OpenAI-compatible response echoed prompt scaffolding");
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
