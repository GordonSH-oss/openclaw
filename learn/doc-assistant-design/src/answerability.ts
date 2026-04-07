import type { DocSearchHit } from "./protocol/index.js";
import { isBroadIntegrationRequest, selectRequiredAnchors } from "./question-anchors.js";
import { buildQuestionState, type QuestionState } from "./question-state.js";
import { labelEvidenceHit } from "./task-frame.js";

type AnswerabilityVerdict = "answerable" | "insufficient_evidence";

export type AnswerabilityDecision = {
  verdict: AnswerabilityVerdict;
  reason?: string;
  matchedAnchors?: string[];
  requiredAnchors?: string[];
};

function normalizeAnswerabilityText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bjavascript\b/g, "web")
    .replace(/\bjs\b/g, "web")
    .replace(/\bdirectchannel\b/g, "direct channel")
    .replace(/\bgroupchannel\b/g, "group channel")
    .replace(/\bopenchannel\b/g, "open channel")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEvidencePath(path: string): string {
  const docsIndex = path.indexOf("/docs/");
  if (docsIndex >= 0) {
    return path.slice(docsIndex + 1);
  }
  return path;
}

function collectEvidenceText(hits: DocSearchHit[]): string {
  return normalizeAnswerabilityText(
    hits
      .map((hit) =>
        [normalizeEvidencePath(hit.path), hit.heading ?? "", hit.snippet, hit.text].join("\n"),
      )
      .join("\n"),
  );
}

function detectStableSlotMismatch(state: QuestionState, hits: DocSearchHit[]): string | undefined {
  const normalizedHits = hits.map((hit) =>
    normalizeAnswerabilityText(
      [normalizeEvidencePath(hit.path), hit.heading ?? "", hit.text].join("\n"),
    ),
  );

  if (state.platform) {
    const requestedPlatform = state.platform;
    const anyExplicitPlatform = normalizedHits.some((text) =>
      ["android", "ios", "web", "flutter"].some((platform) => text.includes(platform)),
    );
    const hasPlatformCoverage = normalizedHits.some((text) => text.includes(requestedPlatform));
    if (anyExplicitPlatform && !hasPlatformCoverage) {
      return `retrieved evidence does not match the requested platform: ${requestedPlatform}`;
    }
  }

  if (state.apiLayer === "server") {
    const hasServer = normalizedHits.some(
      (text) => text.includes("server api") || text.includes("platform chat api"),
    );
    if (!hasServer) {
      return "retrieved evidence does not match the requested server api layer";
    }
  }
  if (state.apiLayer === "client") {
    const hasClient = normalizedHits.some(
      (text) => text.includes("client sdk") || text.includes("sdk") || text.includes("client side"),
    );
    if (!hasClient) {
      return "retrieved evidence does not match the requested client sdk layer";
    }
  }

  return undefined;
}

function anchorCovered(evidenceText: string, anchor: string): boolean {
  const normalizedAnchor = normalizeAnswerabilityText(anchor);
  return evidenceText.includes(normalizedAnchor);
}

function hitCoversAnchor(hit: DocSearchHit, anchor: string): boolean {
  const text = normalizeAnswerabilityText(
    [normalizeEvidencePath(hit.path), hit.heading ?? "", hit.snippet, hit.text].join("\n"),
  );
  return anchorCovered(text, anchor);
}

const GENERIC_PROCEDURAL_VERBS = new Set([
  "configure",
  "initialize",
  "integrate",
  "list",
  "send",
  "update",
]);

export function decideAnswerability(params: {
  question: string;
  state?: QuestionState;
  hits: DocSearchHit[];
}): AnswerabilityDecision {
  const state = params.state ?? buildQuestionState(params.question);
  if (params.hits.length === 0) {
    return {
      verdict: "insufficient_evidence",
      reason: "no relevant documentation evidence was retrieved",
      requiredAnchors: selectRequiredAnchors(state),
      matchedAnchors: [],
    };
  }

  const stableSlotMismatch = detectStableSlotMismatch(state, params.hits);
  if (stableSlotMismatch) {
    return {
      verdict: "insufficient_evidence",
      reason: stableSlotMismatch,
      requiredAnchors: selectRequiredAnchors(state),
      matchedAnchors: [],
    };
  }

  const evidenceText = collectEvidenceText(params.hits);
  const requiredAnchors = selectRequiredAnchors(state);
  const matchedAnchors = requiredAnchors.filter((anchor) => anchorCovered(evidenceText, anchor));
  const missingAnchors = requiredAnchors.filter((anchor) => !matchedAnchors.includes(anchor));
  const primaryHits = params.hits.filter((hit) => !hit.path.includes("/partials/"));
  const primaryEvidenceText = primaryHits.length > 0 ? collectEvidenceText(primaryHits) : "";
  const primaryMatchedAnchors =
    primaryHits.length > 0
      ? requiredAnchors.filter((anchor) => anchorCovered(primaryEvidenceText, anchor))
      : [];
  const partialOnlyAnchors = matchedAnchors.filter(
    (anchor) => !primaryMatchedAnchors.includes(anchor),
  );

  if (
    (state.product === "server" || state.apiLayer === "server") &&
    isBroadIntegrationRequest(state)
  ) {
    return {
      verdict: "insufficient_evidence",
      reason: "server api integration request still needs a narrower task focus",
      requiredAnchors,
      matchedAnchors,
    };
  }

  if (params.hits.every((hit) => hit.path.includes("/partials/"))) {
    return {
      verdict: "insufficient_evidence",
      reason: "only non-authoritative partial documentation was retrieved",
      requiredAnchors,
      matchedAnchors,
    };
  }

  if (partialOnlyAnchors.length > 0) {
    return {
      verdict: "insufficient_evidence",
      reason: `authoritative documentation is missing required anchors: ${partialOnlyAnchors.join(", ")}`,
      requiredAnchors,
      matchedAnchors: primaryMatchedAnchors,
    };
  }

  if (missingAnchors.length > 0) {
    return {
      verdict: "insufficient_evidence",
      reason: `retrieved evidence is missing required anchors: ${missingAnchors.join(", ")}`,
      requiredAnchors,
      matchedAnchors,
    };
  }

  if (state.intent !== "concept") {
    const nounAnchors = state.anchors.nounPhrases;
    const relaxChannelCreationCheck = nounAnchors.some(
      (anchor) => anchor === "channel" || anchor === "conversation" || anchor.includes("channel"),
    );
    const verbAnchors = state.anchors.verbPhrases.filter(
      (anchor) =>
        !GENERIC_PROCEDURAL_VERBS.has(anchor) &&
        !(relaxChannelCreationCheck && (anchor === "create" || anchor === "start")),
    );
    if (
      nounAnchors.length > 0 &&
      verbAnchors.length > 0 &&
      !params.hits.some(
        (hit) =>
          nounAnchors.some((anchor) => hitCoversAnchor(hit, anchor)) &&
          verbAnchors.some((anchor) => hitCoversAnchor(hit, anchor)),
      )
    ) {
      return {
        verdict: "insufficient_evidence",
        reason: "retrieved evidence does not cover the requested object and action together",
        requiredAnchors,
        matchedAnchors,
      };
    }
    const evidenceLabels = params.hits.map((hit) => labelEvidenceHit(hit).labels);
    const hasProceduralEvidence = evidenceLabels.some((labels) =>
      labels.some((label) => label === "procedure" || label === "setup" || label === "event"),
    );
    if (!hasProceduralEvidence) {
      return {
        verdict: "insufficient_evidence",
        reason: "retrieved evidence does not contain an executable documented procedure",
        requiredAnchors,
        matchedAnchors,
      };
    }
    const allHitsAreOverviewOrReference = params.hits.every((hit) => {
      const labels = labelEvidenceHit(hit).labels;
      const onlyOverviewOrReference = labels.every(
        (label) =>
          label === "overview" ||
          label === "reference" ||
          label === "definition" ||
          label === "client_only" ||
          label === "server_only",
      );
      return (
        onlyOverviewOrReference &&
        hit.docShape !== "quickstart_step" &&
        hit.docShape !== "specialized_task"
      );
    });
    if (allHitsAreOverviewOrReference) {
      return {
        verdict: "insufficient_evidence",
        reason:
          "retrieved evidence is only overview or reference material, not a task-focused procedure",
        requiredAnchors,
        matchedAnchors,
      };
    }
  }

  return {
    verdict: "answerable",
    requiredAnchors,
    matchedAnchors,
  };
}
