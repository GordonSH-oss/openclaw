import type { DocCitation, DocSearchHit } from "./protocol/index.js";
import type { QuestionState } from "./question-state.js";

export type EvidenceGroupPurpose =
  | "definition"
  | "task_steps"
  | "prerequisite"
  | "overview"
  | "api_reference"
  | "constraint";

export type EvidenceGroup = {
  id: string;
  purpose: EvidenceGroupPurpose;
  path: string;
  heading?: string;
  citations: DocCitation[];
  summary: string;
  snippets: string[];
  score: number;
  platform?: "android" | "ios" | "web" | "flutter" | "general";
};

export type EvidenceTrimEvent = {
  reason: "group_budget" | "total_budget" | "dedupe";
  droppedGroupIds?: string[];
  droppedCitationCount?: number;
};

export type EvidencePack = {
  questionState: QuestionState;
  groups: EvidenceGroup[];
  warnings: string[];
  trimEvents: EvidenceTrimEvent[];
};

function detectPlatform(hit: DocSearchHit): EvidenceGroup["platform"] {
  const text = [hit.path, hit.heading ?? "", hit.text].join("\n").toLowerCase();
  if (text.includes("android")) {
    return "android";
  }
  if (text.includes("ios")) {
    return "ios";
  }
  if (text.includes("web")) {
    return "web";
  }
  if (text.includes("flutter")) {
    return "flutter";
  }
  return "general";
}

function toCitation(hit: DocSearchHit): DocCitation {
  return {
    path: hit.path,
    heading: hit.heading,
    startLine: hit.startLine,
    endLine: hit.endLine,
    snippet: hit.snippet,
  };
}

function classifyEvidencePurpose(hit: DocSearchHit): EvidenceGroupPurpose {
  const normalized = [hit.path, hit.heading ?? "", hit.text].join("\n").toLowerCase();
  if (hit.retrievalBucket === "concept") {
    if (normalized.includes("overview") || normalized.includes("what is ")) {
      return "definition";
    }
    return "overview";
  }
  if (
    normalized.includes("create") ||
    normalized.includes("creating") ||
    normalized.includes("step") ||
    normalized.includes("send") ||
    normalized.includes("message")
  ) {
    return "task_steps";
  }
  if (
    normalized.includes("requirement") ||
    normalized.includes("prerequisite") ||
    normalized.includes("initialize") ||
    normalized.includes("connect")
  ) {
    return "prerequisite";
  }
  if (
    normalized.includes("server api") ||
    normalized.includes(" api ") ||
    normalized.includes("params")
  ) {
    return "api_reference";
  }
  if (
    normalized.includes("note") ||
    normalized.includes("limit") ||
    normalized.includes("constraint")
  ) {
    return "constraint";
  }
  return "task_steps";
}

function mergeAdjacentHits(hits: DocSearchHit[]): DocSearchHit[] {
  const merged: DocSearchHit[] = [];
  for (const hit of hits.slice().toSorted((a, b) => {
    if (a.path !== b.path) {
      return a.path.localeCompare(b.path);
    }
    return a.startLine - b.startLine;
  })) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.path === hit.path &&
      previous.heading === hit.heading &&
      hit.startLine - previous.endLine <= 12
    ) {
      previous.endLine = hit.endLine;
      previous.snippet = `${previous.snippet} ${hit.snippet}`.trim();
      previous.text = `${previous.text}\n${hit.text}`.trim();
      previous.score = Math.max(previous.score, hit.score);
      continue;
    }
    merged.push({ ...hit });
  }
  return merged;
}

function trimSnippet(snippet: string, budget: number): string {
  if (snippet.length <= budget) {
    return snippet;
  }
  return `${snippet.slice(0, Math.max(0, budget - 1)).trim()}…`;
}

function detectEvidenceWarnings(state: QuestionState, groups: EvidenceGroup[]): string[] {
  const warnings: string[] = [];
  const purposes = new Set(groups.map((group) => group.purpose));
  if (state.intent === "concept" && !purposes.has("definition") && !purposes.has("overview")) {
    warnings.push("missing_definition_evidence");
  }
  if (state.intent === "procedural" && !purposes.has("task_steps")) {
    warnings.push("missing_task_steps_evidence");
  }
  if (state.intent === "mixed" && (!purposes.has("definition") || !purposes.has("task_steps"))) {
    warnings.push("mixed_question_missing_balanced_evidence");
  }
  return warnings;
}

export function buildEvidencePack(params: {
  state: QuestionState;
  hits: DocSearchHit[];
  totalBudgetChars?: number;
  groupBudgetChars?: number;
}): EvidencePack {
  const totalBudgetChars = params.totalBudgetChars ?? 5000;
  const groupBudgetChars = params.groupBudgetChars ?? 1200;
  const trimEvents: EvidenceTrimEvent[] = [];
  const merged = mergeAdjacentHits(params.hits);
  const groupsByKey = new Map<string, EvidenceGroup>();

  for (const hit of merged) {
    const purpose = classifyEvidencePurpose(hit);
    const key = `${purpose}:${hit.path}`;
    const snippet = hit.snippet.trim();
    const current = groupsByKey.get(key);
    if (!current) {
      groupsByKey.set(key, {
        id: key,
        purpose,
        path: hit.path,
        heading: hit.heading,
        citations: [toCitation(hit)],
        summary: trimSnippet(snippet, 220),
        snippets: [snippet],
        score: hit.score,
        platform: detectPlatform(hit),
      });
      continue;
    }
    const before = current.snippets.length;
    if (!current.snippets.includes(snippet)) {
      current.snippets.push(snippet);
      current.citations.push(toCitation(hit));
      current.score = Math.max(current.score, hit.score);
      if (current.summary.length < 220) {
        current.summary = trimSnippet(`${current.summary} ${snippet}`.trim(), 220);
      }
    }
    if (current.snippets.length === before) {
      trimEvents.push({
        reason: "dedupe",
        droppedGroupIds: [current.id],
        droppedCitationCount: 1,
      });
    }
  }

  let groups = Array.from(groupsByKey.values())
    .map((group) => {
      const trimmedSnippets: string[] = [];
      let used = 0;
      for (const snippet of group.snippets) {
        if (used >= groupBudgetChars) {
          break;
        }
        const remaining = groupBudgetChars - used;
        const next = trimSnippet(snippet, remaining);
        if (!next) {
          continue;
        }
        if (next.length < snippet.length) {
          trimEvents.push({
            reason: "group_budget",
            droppedGroupIds: [group.id],
          });
        }
        trimmedSnippets.push(next);
        used += next.length;
      }
      if (trimmedSnippets.length < group.snippets.length) {
        trimEvents.push({
          reason: "group_budget",
          droppedGroupIds: [group.id],
          droppedCitationCount: group.snippets.length - trimmedSnippets.length,
        });
      }
      return {
        ...group,
        snippets: trimmedSnippets,
      };
    })
    .toSorted((left, right) => right.score - left.score);

  let totalChars = groups.reduce(
    (sum, group) => sum + group.summary.length + group.snippets.join("").length,
    0,
  );
  if (totalChars > totalBudgetChars) {
    const kept: EvidenceGroup[] = [];
    const dropped: string[] = [];
    let used = 0;
    for (const group of groups) {
      const size = group.summary.length + group.snippets.join("").length;
      const mustKeep =
        (params.state.intent === "concept" &&
          (group.purpose === "definition" || group.purpose === "overview")) ||
        (params.state.intent === "procedural" && group.purpose === "task_steps") ||
        (params.state.intent === "mixed" &&
          (group.purpose === "definition" || group.purpose === "task_steps"));
      if (!mustKeep && used + size > totalBudgetChars) {
        dropped.push(group.id);
        continue;
      }
      kept.push(group);
      used += size;
    }
    groups = kept;
    totalChars = used;
    if (dropped.length > 0) {
      trimEvents.push({
        reason: "total_budget",
        droppedGroupIds: dropped,
      });
    }
  }

  return {
    questionState: params.state,
    groups,
    warnings: detectEvidenceWarnings(params.state, groups),
    trimEvents,
  };
}
