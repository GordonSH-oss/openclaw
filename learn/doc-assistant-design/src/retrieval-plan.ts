import { extractQuestionAnchors, summarizeAnchorFocus } from "./question-anchors.js";
import { planDocQuestion } from "./question-planning.js";
import type { QuestionState } from "./question-state.js";
import type { RetrievalBudget } from "./retrieval-budget.js";

export type RetrievalPurpose =
  | "primary_concept"
  | "primary_procedural"
  | "prerequisite"
  | "overview"
  | "adjacent"
  | "api";

export type RetrievalQuery = {
  purpose: RetrievalPurpose;
  query: string;
  bucket?: "concept" | "procedural";
  limit: number;
};

export type RetrievalPlan = {
  primaryQueries: RetrievalQuery[];
  expansionQueries: RetrievalQuery[];
};

function dedupeQueries(queries: RetrievalQuery[]): RetrievalQuery[] {
  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = `${query.purpose}:${query.bucket ?? ""}:${query.query.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildPlatformHint(state: QuestionState): string {
  if (!state.platform) {
    return "";
  }
  if (state.platform === "ios") {
    return "iOS";
  }
  if (state.platform === "web") {
    return "Web";
  }
  if (state.platform === "flutter") {
    return "Flutter";
  }
  return "Android";
}

function buildStableSlotHints(state: QuestionState): string[] {
  const hints: string[] = [];
  const platform = buildPlatformHint(state);
  if (platform) {
    hints.push(platform);
  }
  if (state.product === "server") {
    hints.push("Server API");
  } else if (state.product === "call") {
    hints.push("Call SDK");
  } else if (state.product === "chat") {
    hints.push("Chat SDK");
  }
  if (state.apiLayer === "server") {
    hints.push("server api");
  } else if (state.apiLayer === "client") {
    hints.push("client sdk");
  }
  if (state.channelKind === "direct") {
    hints.push("direct channel");
  } else if (state.channelKind === "group") {
    hints.push("group channel");
  } else if (state.channelKind === "community") {
    hints.push("community channel");
  } else if (state.channelKind === "open") {
    hints.push("open channel");
  }
  if (state.referent) {
    hints.push(state.referent);
  }
  return hints;
}

function buildExpansionSeeds(
  question: string,
  state: QuestionState,
): Array<{
  purpose: RetrievalPurpose;
  query: string;
  bucket: "concept" | "procedural";
}> {
  const stableSlotHints = buildStableSlotHints(state);
  const focus = summarizeAnchorFocus(state.anchors).slice(0, 3);
  const verbs = state.anchors.verbPhrases.slice(0, 2);
  const constraints = state.anchors.constraints.slice(0, 2);
  const apiSymbols = state.anchors.apiSymbols.slice(0, 2);
  const hasStructuredFocus =
    stableSlotHints.length > 0 ||
    state.anchors.nounPhrases.length > 0 ||
    state.anchors.qualifiers.length > 0 ||
    constraints.length > 0 ||
    apiSymbols.length > 0;
  const seeds: Array<{
    purpose: RetrievalPurpose;
    query: string;
    bucket: "concept" | "procedural";
  }> = [];

  if (focus.length > 0 || stableSlotHints.length > 0) {
    seeds.push({
      purpose: "overview",
      query: [...stableSlotHints, ...focus].filter(Boolean).join(" "),
      bucket: "concept",
    });
  }

  if (hasStructuredFocus) {
    seeds.push({
      purpose: "prerequisite",
      query: [...stableSlotHints, ...focus, ...verbs, "quickstart setup"].filter(Boolean).join(" "),
      bucket: "procedural",
    });
  }

  if (constraints.length > 0) {
    seeds.push({
      purpose: "adjacent",
      query: [...stableSlotHints, ...focus, ...constraints].filter(Boolean).join(" "),
      bucket: "procedural",
    });
  }

  if (apiSymbols.length > 0 || question.toLowerCase().includes("api")) {
    seeds.push({
      purpose: "api",
      query: [...stableSlotHints, ...apiSymbols, ...focus, "api"].filter(Boolean).join(" "),
      bucket: "procedural",
    });
  }

  return seeds.filter((seed) => seed.query.trim().length > 0);
}

export function buildRetrievalPlan(params: {
  state: QuestionState;
  maxResults?: number;
  budget?: RetrievalBudget;
}): RetrievalPlan {
  const maxResults = Math.max(3, params.budget?.hitLimit ?? params.maxResults ?? 5);
  const conceptPrimaryLimit = params.budget?.primaryConceptLimit ?? Math.min(maxResults, 4);
  const proceduralPrimaryLimit = params.budget?.primaryProceduralLimit ?? Math.min(maxResults, 4);
  const overviewExpansionLimit = params.budget?.overviewExpansionLimit ?? 2;
  const relatedExpansionLimit = params.budget?.relatedExpansionLimit ?? 2;
  const maxPrimaryQueries = params.budget?.maxPrimaryQueries ?? 3;
  const maxExpansionQueries = params.budget?.maxExpansionQueries ?? 4;
  const plan = planDocQuestion(params.state.rawQuestion);
  const primaryQueries: RetrievalQuery[] = [];
  const expansionQueries: RetrievalQuery[] = [];

  if (plan.kind === "mixed") {
    for (const step of plan.steps) {
      const anchors = extractQuestionAnchors(step.question);
      primaryQueries.push({
        purpose: step.intent === "concept" ? "primary_concept" : "primary_procedural",
        query: step.question,
        bucket: step.intent === "concept" ? "concept" : "procedural",
        limit: step.intent === "concept" ? conceptPrimaryLimit : proceduralPrimaryLimit,
      });
      for (const seed of buildExpansionSeeds(step.question, {
        ...params.state,
        intent: step.intent,
        anchors,
      })) {
        expansionQueries.push({
          purpose: seed.purpose,
          query: seed.query,
          bucket: seed.bucket,
          limit: seed.purpose === "overview" ? overviewExpansionLimit : relatedExpansionLimit,
        });
      }
    }
  } else {
    primaryQueries.push({
      purpose: params.state.intent === "concept" ? "primary_concept" : "primary_procedural",
      query: params.state.rawQuestion,
      bucket: params.state.intent === "concept" ? "concept" : "procedural",
      limit: params.state.intent === "concept" ? conceptPrimaryLimit : proceduralPrimaryLimit,
    });
    for (const seed of buildExpansionSeeds(params.state.rawQuestion, params.state)) {
      expansionQueries.push({
        purpose: seed.purpose,
        query: seed.query,
        bucket: seed.bucket,
        limit: seed.purpose === "overview" ? overviewExpansionLimit : relatedExpansionLimit,
      });
    }
  }

  return {
    primaryQueries: dedupeQueries(primaryQueries).slice(0, maxPrimaryQueries),
    expansionQueries: dedupeQueries(expansionQueries).slice(0, maxExpansionQueries),
  };
}
