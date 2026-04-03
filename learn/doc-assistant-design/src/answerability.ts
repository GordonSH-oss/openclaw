import type { DocSearchHit } from "./protocol/index.js";
import { buildQuestionState, type QuestionState } from "./question-state.js";

type AnswerabilityVerdict = "answerable" | "insufficient_evidence";

export type AnswerabilityDecision = {
  verdict: AnswerabilityVerdict;
  reason?: string;
  matchedAnchors?: string[];
  requiredAnchors?: string[];
};

type AnchorRule = {
  required: string[];
  questionGroups: string[][];
  evidenceGroups: string[][];
  reason: string;
};

const ANCHOR_RULES: AnchorRule[] = [
  {
    required: ["push", "notification"],
    questionGroups: [
      ["language", "locale", "localization"],
      ["default", "preference", "default language", "language preference"],
    ],
    evidenceGroups: [
      [
        "display language",
        "language preference",
        "specified locale",
        "locale for the current user",
        "push notification language",
      ],
    ],
    reason:
      "question asks about push-notification language but the retrieved evidence does not cover language or localization",
  },
];

const GENERIC_QUESTION_TOKENS = new Set([
  "about",
  "change",
  "default",
  "define",
  "definition",
  "explain",
  "how",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

const PROCEDURAL_ACTION_TOKENS = [
  "accept",
  "add",
  "begin",
  "check",
  "configure",
  "connect",
  "create",
  "delete",
  "destroy",
  "dismiss",
  "get",
  "initialize",
  "install",
  "join",
  "leave",
  "list",
  "load",
  "open",
  "query",
  "receive",
  "reload",
  "remove",
  "retrieve",
  "send",
  "set up",
  "setup",
  "start",
  "update",
  "use",
];

const PROCEDURAL_FOCUS_STOP_TOKENS = new Set([
  "accept",
  "action",
  "add",
  "android",
  "answer",
  "api",
  "app",
  "begin",
  "browser",
  "call",
  "channel",
  "channels",
  "chat",
  "check",
  "client",
  "community",
  "configure",
  "connect",
  "conversation",
  "create",
  "default",
  "delete",
  "destroy",
  "direct",
  "dismiss",
  "documented",
  "feature",
  "first",
  "flutter",
  "group",
  "initialize",
  "install",
  "ios",
  "join",
  "leave",
  "list",
  "load",
  "message",
  "messages",
  "notification",
  "notifications",
  "open",
  "platform",
  "procedural",
  "push",
  "query",
  "receive",
  "reload",
  "remove",
  "retrieve",
  "setting",
  "settings",
  "sdk",
  "send",
  "server",
  "setup",
  "start",
  "steps",
  "subchannel",
  "task",
  "update",
  "use",
  "web",
  "webhook",
]);

function isConceptDefinitionQuestion(question: string): boolean {
  const normalized = normalizeAnswerabilityText(question);
  return (
    normalized.startsWith("what ") ||
    normalized.startsWith("what s ") ||
    normalized.startsWith("whats ") ||
    normalized.startsWith("define ") ||
    normalized.startsWith("definition of ") ||
    normalized.startsWith("explain ") ||
    normalized.startsWith("什么是") ||
    normalized.startsWith("什么叫") ||
    normalized.startsWith("解释")
  );
}

function isProceduralReferenceQuestion(question: string): boolean {
  const normalized = normalizeAnswerabilityText(question);
  return (
    normalized.startsWith("where ") ||
    normalized.startsWith("where does ") ||
    normalized.startsWith("where do ") ||
    normalized.startsWith("which ") ||
    normalized.startsWith("which file ") ||
    normalized.startsWith("which doc ")
  );
}

function extractCoverageTokens(text: string): string[] {
  return Array.from(
    new Set(
      normalizeAnswerabilityText(text)
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !GENERIC_QUESTION_TOKENS.has(token)),
    ),
  );
}

function extractProceduralActionTokens(question: string): string[] {
  return PROCEDURAL_ACTION_TOKENS.filter((token) => hasNormalizedAnchor(question, token));
}

function extractProceduralFocusTokens(question: string): string[] {
  return Array.from(
    new Set(
      normalizeAnswerabilityText(question)
        .split(/\s+/)
        .filter(
          (token) =>
            token.length >= 4 &&
            !GENERIC_QUESTION_TOKENS.has(token) &&
            !PROCEDURAL_FOCUS_STOP_TOKENS.has(token),
        ),
    ),
  );
}

function hitCoversProceduralFocus(params: {
  hit: DocSearchHit;
  actionTokens: string[];
  focusTokens: string[];
}): boolean {
  return (
    params.actionTokens.some((token) =>
      hasNormalizedAnchor(
        [params.hit.path, params.hit.heading ?? "", params.hit.snippet, params.hit.text].join("\n"),
        token,
      ),
    ) &&
    params.focusTokens.some((token) =>
      hasNormalizedAnchor(
        [params.hit.path, params.hit.heading ?? "", params.hit.snippet, params.hit.text].join("\n"),
        token,
      ),
    )
  );
}

function normalizeAnswerabilityText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\blanguages\b/g, "language")
    .replace(/\blocalisation\b/g, "localization")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ")
    .trim();
}

function hasNormalizedAnchor(text: string, anchor: string): boolean {
  const normalizedText = normalizeAnswerabilityText(text);
  const normalizedAnchor = normalizeAnswerabilityText(anchor);
  if (!normalizedText || !normalizedAnchor) {
    return false;
  }
  const padded = ` ${normalizedText} `;
  return padded.includes(` ${normalizedAnchor} `);
}

function countMatchedAnchors(text: string, anchors: string[]): string[] {
  return anchors.filter((anchor) => text.includes(normalizeAnswerabilityText(anchor)));
}

function filterAuthoritativeHits(hits: DocSearchHit[]): DocSearchHit[] {
  return hits.filter((hit) => {
    const normalizedPath = hit.path.toLowerCase();
    const basename = normalizedPath.split("/").at(-1) ?? normalizedPath;
    return !normalizedPath.includes("/partials/") && !basename.startsWith("_");
  });
}

function buildEvidenceText(hits: DocSearchHit[]): string {
  return hits
    .slice(0, 6)
    .map((hit) => {
      const basename = hit.path.split("/").at(-1) ?? hit.path;
      return [basename, hit.heading ?? "", hit.snippet, hit.text].join("\n");
    })
    .join("\n");
}

export function decideAnswerability(params: {
  question: string;
  hits: DocSearchHit[];
  state?: QuestionState;
}): AnswerabilityDecision {
  if (params.hits.length === 0) {
    return {
      verdict: "insufficient_evidence",
      reason: "no documentation hits were retrieved",
      requiredAnchors: [],
      matchedAnchors: [],
    };
  }

  const authoritativeHits = filterAuthoritativeHits(params.hits);
  if (authoritativeHits.length === 0) {
    return {
      verdict: "insufficient_evidence",
      reason: "only non-authoritative partial documentation was retrieved",
      requiredAnchors: [],
      matchedAnchors: [],
    };
  }

  const normalizedQuestion = normalizeAnswerabilityText(params.question);
  const normalizedEvidence = normalizeAnswerabilityText(buildEvidenceText(authoritativeHits));
  const state = params.state ?? buildQuestionState(params.question);

  for (const rule of ANCHOR_RULES) {
    const requiredPresent = rule.required.every((anchor) =>
      normalizedQuestion.includes(normalizeAnswerabilityText(anchor)),
    );
    if (!requiredPresent) {
      continue;
    }
    const questionGroupPresent = rule.questionGroups.every(
      (group) => countMatchedAnchors(normalizedQuestion, group).length > 0,
    );
    if (!questionGroupPresent) {
      continue;
    }

    const flattenedAnchors = rule.evidenceGroups.flat();
    const matchedAnchors = rule.evidenceGroups.flatMap((group) =>
      countMatchedAnchors(normalizedEvidence, group),
    );
    const matchedGroupCount = rule.evidenceGroups.filter(
      (group) => countMatchedAnchors(normalizedEvidence, group).length > 0,
    ).length;
    if (matchedGroupCount < rule.evidenceGroups.length) {
      return {
        verdict: "insufficient_evidence",
        reason: rule.reason,
        requiredAnchors: flattenedAnchors,
        matchedAnchors,
      };
    }
  }

  if (isConceptDefinitionQuestion(params.question)) {
    const coverageTokens = extractCoverageTokens(params.question);
    const matchedCoverageTokens = coverageTokens.filter((token) =>
      normalizedEvidence.includes(token),
    );
    if (coverageTokens.length > 0 && matchedCoverageTokens.length === 0) {
      return {
        verdict: "insufficient_evidence",
        reason: "retrieved evidence does not define the asked concept directly",
        requiredAnchors: coverageTokens,
        matchedAnchors: matchedCoverageTokens,
      };
    }
  }

  if (state.intent !== "concept") {
    // Location / reference lookups can be answered from a single descriptive sentence and do not
    // need the same executable-procedure coverage that true how-to questions require.
    if (isProceduralReferenceQuestion(params.question)) {
      return {
        verdict: "answerable",
      };
    }

    const proceduralActionTokens = extractProceduralActionTokens(params.question);
    const proceduralFocusTokens = extractProceduralFocusTokens(params.question);
    if (
      proceduralActionTokens.length > 0 &&
      proceduralFocusTokens.length > 0 &&
      !authoritativeHits.some((hit) =>
        hitCoversProceduralFocus({
          hit,
          actionTokens: proceduralActionTokens,
          focusTokens: proceduralFocusTokens,
        }),
      )
    ) {
      return {
        verdict: "insufficient_evidence",
        reason: "retrieved evidence does not cover the requested object and action together",
        requiredAnchors: [...proceduralActionTokens, ...proceduralFocusTokens],
        matchedAnchors: proceduralFocusTokens.filter((token) => normalizedEvidence.includes(token)),
      };
    }

    const hasTaskAction =
      normalizedEvidence.includes("send") ||
      normalizedEvidence.includes("create") ||
      normalizedEvidence.includes("start") ||
      normalizedEvidence.includes("initialize") ||
      normalizedEvidence.includes("import") ||
      normalizedEvidence.includes("connect");
    const hasStepCoverage =
      normalizedEvidence.includes("step") ||
      normalizedEvidence.includes("quickstart") ||
      normalizedEvidence.includes("sendmessage") ||
      normalizedEvidence.includes("messageparams");
    const metadataOnly = authoritativeHits.every((hit) => {
      const normalizedHit = normalizeAnswerabilityText(
        [hit.path, hit.heading ?? "", hit.text].join("\n"),
      );
      return (
        normalizedHit.includes("status code") ||
        normalizedHit.includes("error code") ||
        normalizedHit.includes("monitor status") ||
        normalizedHit.includes("reconnection") ||
        normalizedHit.includes("overview")
      );
    });

    if (
      (state.taskKind === "send_message" ||
        state.taskKind === "first_message" ||
        state.taskKind === "start_chat") &&
      (!hasTaskAction || (!hasStepCoverage && metadataOnly))
    ) {
      return {
        verdict: "insufficient_evidence",
        reason: "retrieved evidence does not cover a concrete executable procedure for this task",
        requiredAnchors: ["task steps", "executable procedure"],
        matchedAnchors: [
          ...(hasTaskAction ? ["task action"] : []),
          ...(hasStepCoverage ? ["step coverage"] : []),
        ],
      };
    }
  }

  return {
    verdict: "answerable",
  };
}
