import type { QuestionState } from "./question-state.js";

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

function buildReferentHint(state: QuestionState): string {
  return state.referent ?? state.channelKind ?? state.product ?? "";
}

export function buildRetrievalPlan(params: {
  state: QuestionState;
  maxResults?: number;
}): RetrievalPlan {
  const maxResults = Math.max(3, params.maxResults ?? 5);
  const platformHint = buildPlatformHint(params.state);
  const referentHint = buildReferentHint(params.state);
  const normalizedQuestion = params.state.normalizedQuestion;
  const primaryQueries: RetrievalQuery[] = [];
  const expansionQueries: RetrievalQuery[] = [];
  const hasSpecificProceduralAnchor = Boolean(
    platformHint ||
    referentHint ||
    params.state.product ||
    params.state.channelKind ||
    params.state.apiLayer ||
    params.state.taskKind !== "generic",
  );

  if (params.state.intent === "concept") {
    primaryQueries.push({
      purpose: "primary_concept",
      query: params.state.rawQuestion,
      bucket: "concept",
      limit: Math.min(maxResults, 4),
    });
    if (referentHint) {
      expansionQueries.push({
        purpose: "overview",
        query: `what is ${referentHint}`.trim(),
        bucket: "concept",
        limit: 2,
      });
    }
    return { primaryQueries, expansionQueries };
  }

  if (params.state.intent === "mixed") {
    primaryQueries.push({
      purpose: "primary_concept",
      query: params.state.rawQuestion,
      bucket: "concept",
      limit: 3,
    });
    primaryQueries.push({
      purpose: "primary_procedural",
      query: params.state.rawQuestion,
      bucket: "procedural",
      limit: Math.min(maxResults, 4),
    });
    if (referentHint) {
      expansionQueries.push({
        purpose: "overview",
        query: `what is ${referentHint}`.trim(),
        bucket: "concept",
        limit: 2,
      });
    }
    return { primaryQueries, expansionQueries };
  }

  const primaryProceduralQuery =
    normalizedQuestion.includes("push notification") &&
    (normalizedQuestion.includes("click") ||
      normalizedQuestion.includes("conversation") ||
      normalizedQuestion.includes("open"))
      ? [platformHint, "push notification click channel page conversation intent-filter"]
          .filter(Boolean)
          .join(" ")
      : params.state.rawQuestion;

  primaryQueries.push({
    purpose: "primary_procedural",
    query: primaryProceduralQuery,
    bucket: "procedural",
    limit: Math.min(maxResults, 4),
  });

  if (
    hasSpecificProceduralAnchor &&
    (params.state.taskKind === "first_message" ||
      params.state.taskKind === "send_message" ||
      params.state.taskKind === "start_chat" ||
      params.state.taskKind === "generic" ||
      params.state.taskKind === "channel_creation")
  ) {
    expansionQueries.push({
      purpose: "prerequisite",
      query: [platformHint, referentHint, "quickstart initialize connect setup"]
        .filter(Boolean)
        .join(" "),
      bucket: "procedural",
      limit: 2,
    });
  }

  if (referentHint) {
    expansionQueries.push({
      purpose: "overview",
      query: `what is ${referentHint}`.trim(),
      bucket: "concept",
      limit: 2,
    });
  }

  if (
    params.state.rawQuestion.toLowerCase().includes("api") ||
    params.state.rawQuestion.toLowerCase().includes("connect") ||
    params.state.taskKind === "send_message" ||
    params.state.taskKind === "channel_creation"
  ) {
    expansionQueries.push({
      purpose: "api",
      query: [platformHint, params.state.rawQuestion, "api"].filter(Boolean).join(" "),
      bucket: "procedural",
      limit: 2,
    });
  }

  return {
    primaryQueries: primaryQueries.slice(0, 2),
    expansionQueries: expansionQueries.slice(0, 3),
  };
}
