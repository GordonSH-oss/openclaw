import { isBroadIntegrationRequest, selectSpecificUnknownTerms } from "./question-anchors.js";
import { planDocQuestion } from "./question-planning.js";
import type { QuestionState } from "./question-state.js";

export type RetrievalBudgetSource = "dynamic" | "override";

export type RetrievalBudget = {
  source: RetrievalBudgetSource;
  hitLimit: number;
  primaryConceptLimit: number;
  primaryProceduralLimit: number;
  overviewExpansionLimit: number;
  relatedExpansionLimit: number;
  maxPrimaryQueries: number;
  maxExpansionQueries: number;
  evidenceTotalBudgetChars: number;
  evidenceGroupBudgetChars: number;
  retryHitLimit: number;
  retryEvidenceTotalBudgetChars: number;
  retryEvidenceGroupBudgetChars: number;
  complexityScore: number;
  reasons: string[];
  overrideMaxResults?: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function countAmbiguities(state: QuestionState): number {
  return [
    state.ambiguity.missingPlatform,
    state.ambiguity.missingChannelKind,
    state.ambiguity.missingApiLayer,
    state.ambiguity.missingProduct,
  ].filter(Boolean).length;
}

function buildBudgetFromHitLimit(params: {
  source: RetrievalBudgetSource;
  hitLimit: number;
  complexityScore: number;
  reasons: string[];
  overrideMaxResults?: number;
}): RetrievalBudget {
  const hitLimit = clamp(params.hitLimit, 4, 12);
  const isLarge = hitLimit >= 8;
  const isMedium = hitLimit >= 6;
  const retryHitLimit =
    params.source === "override" ? hitLimit : clamp(hitLimit + (isLarge ? 2 : 4), 6, 12);

  return {
    source: params.source,
    hitLimit,
    primaryConceptLimit: Math.min(hitLimit, isLarge ? 4 : 3),
    primaryProceduralLimit: Math.min(hitLimit, isLarge ? 5 : 4),
    overviewExpansionLimit: isLarge ? 3 : 2,
    relatedExpansionLimit: isLarge ? 3 : 2,
    maxPrimaryQueries: isLarge ? 4 : 3,
    maxExpansionQueries: isLarge ? 6 : isMedium ? 5 : 4,
    evidenceTotalBudgetChars: isLarge ? 7_000 : isMedium ? 6_000 : 5_000,
    evidenceGroupBudgetChars: isLarge ? 1_500 : isMedium ? 1_350 : 1_200,
    retryHitLimit,
    retryEvidenceTotalBudgetChars:
      params.source === "override"
        ? isLarge
          ? 7_000
          : isMedium
            ? 6_000
            : 5_000
        : isLarge
          ? 8_000
          : 7_000,
    retryEvidenceGroupBudgetChars:
      params.source === "override" ? (isLarge ? 1_500 : isMedium ? 1_350 : 1_200) : 1_700,
    complexityScore: params.complexityScore,
    reasons: params.reasons,
    overrideMaxResults: params.overrideMaxResults,
  };
}

export function resolveRetrievalBudget(params: {
  state: QuestionState;
  overrideMaxResults?: number;
  followUpSource?: "none" | "clarification_reuse" | "clarification_rewrite" | "contextual_rewrite";
}): RetrievalBudget {
  if (params.overrideMaxResults && Number.isFinite(params.overrideMaxResults)) {
    return buildBudgetFromHitLimit({
      source: "override",
      hitLimit: params.overrideMaxResults,
      complexityScore: 0,
      reasons: ["manual_override"],
      overrideMaxResults: params.overrideMaxResults,
    });
  }

  const reasons: string[] = [];
  let complexityScore = 0;
  const plan = planDocQuestion(params.state.rawQuestion);
  const ambiguityCount = countAmbiguities(params.state);
  const broadIntegration = isBroadIntegrationRequest(params.state);
  const specificUnknownTerms = selectSpecificUnknownTerms(params.state.anchors);
  const anchorRichness =
    params.state.anchors.nounPhrases.length +
    params.state.anchors.constraints.length +
    params.state.anchors.apiSymbols.length +
    specificUnknownTerms.length;

  if (params.state.intent === "mixed" || plan.steps.length > 1) {
    complexityScore += 2;
    reasons.push("multi_step_question");
  }
  if (broadIntegration) {
    complexityScore += 2;
    reasons.push("broad_integration");
  }
  if (
    ambiguityCount >= 2 &&
    (broadIntegration || plan.steps.length > 1 || !params.state.platform)
  ) {
    complexityScore += 1;
    reasons.push("ambiguous_scope");
  }
  if (anchorRichness >= 5) {
    complexityScore += 1;
    reasons.push("anchor_dense");
  }
  if (params.state.anchors.apiSymbols.length > 0) {
    complexityScore += 1;
    reasons.push("api_symbol_focus");
  }
  if (params.state.product === "server" && params.state.intent !== "concept") {
    complexityScore += 1;
    reasons.push("server_task");
  }
  if (
    params.followUpSource === "clarification_rewrite" ||
    params.followUpSource === "clarification_reuse"
  ) {
    complexityScore = Math.max(0, complexityScore - 1);
    reasons.push("followup_scope_narrowed");
  }

  const hitLimit =
    complexityScore >= 5 ? 10 : complexityScore >= 3 ? 8 : complexityScore >= 1 ? 6 : 4;

  return buildBudgetFromHitLimit({
    source: "dynamic",
    hitLimit,
    complexityScore,
    reasons,
  });
}
