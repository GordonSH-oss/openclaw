import { decideAnswerability } from "./answerability.js";
import { decideClarification } from "./clarification-policy.js";
import type { EvidencePack } from "./evidence-pack.js";
import type {
  DocAnswerValidationIssue,
  DocAnswerValidationResult,
  DocCitation,
} from "./protocol/index.js";
import type { QuestionState } from "./question-state.js";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bjavascript\b/g, "web")
    .replace(/\bjs\b/g, "web")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ")
    .trim();
}

function collectCitationText(citations: DocCitation[], evidence: EvidencePack): string {
  const groupsByPath = new Map(evidence.groups.map((group) => [group.path, group]));
  return citations
    .map((citation) => {
      const group = groupsByPath.get(citation.path);
      return [citation.path, citation.heading ?? "", citation.snippet, group?.summary ?? ""].join(
        "\n",
      );
    })
    .join("\n");
}

function buildIssue(
  code: DocAnswerValidationIssue["code"],
  severity: DocAnswerValidationIssue["severity"],
  message: string,
): DocAnswerValidationIssue {
  return { code, severity, message };
}

function buildValidationContext(answer: string, citations: DocCitation[]): string {
  return normalize(
    [
      answer,
      ...citations.map((citation) =>
        [citation.path, citation.heading ?? "", citation.snippet].join("\n"),
      ),
    ].join("\n"),
  );
}

function detectCrossPlatform(
  state: QuestionState,
  answer: string,
  citations: DocCitation[],
): boolean {
  if (!state.platform) {
    return false;
  }
  const text = buildValidationContext(answer, citations);
  const others = ["android", "ios", "web", "flutter"].filter(
    (platform) => platform !== state.platform,
  );
  return others.some((platform) => text.includes(platform));
}

function detectCrossApiLayer(
  state: QuestionState,
  answer: string,
  citations: DocCitation[],
): boolean {
  if (!state.apiLayer) {
    return false;
  }
  const text = buildValidationContext(answer, citations);
  if (state.apiLayer === "client") {
    return text.includes("server api");
  }
  return text.includes("client sdk");
}

function shouldCheckCitationTopicMismatch(state: QuestionState): boolean {
  if (!state.referent) {
    return false;
  }
  const normalizedReferent = normalize(state.referent);
  if (!normalizedReferent) {
    return false;
  }
  const tokens = normalizedReferent.split(/\s+/).filter(Boolean);
  if (tokens.length > 5) {
    return false;
  }
  const proceduralTokens = new Set([
    "how",
    "configure",
    "config",
    "check",
    "create",
    "send",
    "connect",
    "start",
    "use",
    "need",
    "setup",
    "set",
    "version",
  ]);
  if (tokens.some((token) => proceduralTokens.has(token))) {
    return false;
  }
  return state.intent === "concept" || state.intent === "mixed";
}

function hasStepSection(answer: string): boolean {
  const normalized = normalize(answer);
  return normalized.includes("steps") || normalized.includes("步骤");
}

function detectMetadataAsStep(answer: string, citations: DocCitation[]): boolean {
  if (!hasStepSection(answer)) {
    return false;
  }
  const text = buildValidationContext(answer, citations);
  return (
    text.includes("status codes") ||
    text.includes("status code") ||
    text.includes("error codes") ||
    text.includes("error code") ||
    text.includes("monitor status") ||
    text.includes("reconnection")
  );
}

function isReleaseNotesQuestion(question: string): boolean {
  const normalizedQuestion = normalize(question);
  return (
    normalizedQuestion.includes("release notes") ||
    normalizedQuestion.includes("version history") ||
    normalizedQuestion.includes("what was added")
  );
}

export function validateAnswer(params: {
  question: string;
  state: QuestionState;
  evidence: EvidencePack;
  answer: string;
  summary: string;
  citations: DocCitation[];
}): DocAnswerValidationResult {
  const issues: DocAnswerValidationIssue[] = [];
  const normalizedSummary = normalize(params.summary);
  const releaseNotesQuestion = isReleaseNotesQuestion(params.question);

  if (
    params.citations.length === 0 &&
    !normalizedSummary.includes("clarification required") &&
    !normalizedSummary.includes("insufficient") &&
    !normalizedSummary.includes("no relevant")
  ) {
    issues.push(buildIssue("missing_citation", "warn", "answer returned without citations"));
  }

  const clarification = decideClarification({
    state: params.state,
    hits: params.evidence.groups.flatMap((group) =>
      group.citations.map((citation) => ({
        ...citation,
        score: group.score,
        text: citation.snippet,
      })),
    ),
  });
  if (clarification.shouldClarify && !normalizedSummary.includes("clarification required")) {
    issues.push(
      buildIssue(
        "missing_clarification",
        "error",
        "answer should have clarified instead of proceeding",
      ),
    );
  }

  if (!releaseNotesQuestion && detectCrossPlatform(params.state, params.answer, params.citations)) {
    issues.push(buildIssue("cross_platform", "error", "answer mixes platforms"));
  }

  if (!releaseNotesQuestion && detectCrossApiLayer(params.state, params.answer, params.citations)) {
    issues.push(buildIssue("cross_api_layer", "error", "answer mixes client and server layers"));
  }

  const answerability = decideAnswerability({
    question: params.question,
    state: params.state,
    hits: params.evidence.groups.flatMap((group) =>
      group.citations.map((citation) => ({
        ...citation,
        score: group.score,
        text: citation.snippet,
      })),
    ),
  });
  if (
    answerability.verdict === "insufficient_evidence" &&
    !normalizedSummary.includes("insufficient")
  ) {
    issues.push(
      buildIssue(
        "off_intent_answer",
        "error",
        answerability.reason ?? "evidence does not cover the question intent",
      ),
    );
  }

  if (detectMetadataAsStep(params.answer, params.citations)) {
    issues.push(
      buildIssue("section_mismatch", "error", "answer turns status metadata into procedural steps"),
    );
  }

  const citationText = normalize(collectCitationText(params.citations, params.evidence));
  if (
    params.citations.length > 0 &&
    shouldCheckCitationTopicMismatch(params.state) &&
    !citationText.includes(normalize(params.state.referent ?? ""))
  ) {
    issues.push(
      buildIssue(
        "citation_topic_mismatch",
        "error",
        "citations do not cover the question referent directly",
      ),
    );
  }

  const errorCodes = new Set(
    issues.filter((issue) => issue.severity === "error").map((issue) => issue.code),
  );
  let downgradeTo: DocAnswerValidationResult["downgradeTo"];
  if (
    errorCodes.has("missing_clarification") ||
    errorCodes.has("cross_platform") ||
    errorCodes.has("cross_api_layer")
  ) {
    downgradeTo = "clarification";
  } else if (
    errorCodes.has("citation_topic_mismatch") ||
    errorCodes.has("off_intent_answer") ||
    errorCodes.has("section_mismatch")
  ) {
    downgradeTo = "insufficient";
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
    downgradeTo,
  };
}
