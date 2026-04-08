import type { AnswerLanguage } from "./answer-language.js";
import type { AnswerPlan } from "./answer-plan.js";
import {
  renderProviderDocumentAccessGuidance,
  type ProviderExpandedDocumentContext,
} from "./document-context.js";
import type { EvidencePack } from "./evidence-pack.js";
import type { DocSearchHit } from "./protocol/index.js";
import type { QuestionState } from "./question-state.js";

function sectionLines(title: string, groupIds: string[], evidence: EvidencePack): string[] {
  const groups = groupIds
    .map((groupId) => evidence.groups.find((group) => group.id === groupId))
    .filter((group): group is NonNullable<typeof group> => Boolean(group));
  if (groups.length === 0) {
    return [];
  }
  return [title, ...groups.slice(0, 3).map((group, index) => `${index + 1}. ${group.summary}`)];
}

export function renderExtractiveAnswer(params: {
  question: string;
  state: QuestionState;
  language: AnswerLanguage;
  plan: AnswerPlan;
  evidence: EvidencePack;
}): string {
  const intro =
    params.language === "en"
      ? `Answer plan for: ${params.question}`
      : `当前问题的回答计划：${params.question}`;
  const sections = params.plan.sections
    .map((section) => sectionLines(section.title, section.evidenceGroupIds, params.evidence))
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join("\n"))
    .join("\n\n");
  return [intro, sections].filter(Boolean).join("\n\n");
}

export function buildAgentPromptFromPlan(params: {
  question: string;
  state: QuestionState;
  language: AnswerLanguage;
  plan: AnswerPlan;
  evidence: EvidencePack;
  draftAnswer: string;
  documentAccessHits?: DocSearchHit[];
  expandedDocumentContexts?: ProviderExpandedDocumentContext[];
}): string {
  const sections = params.plan.sections
    .map((section) => {
      const groups = section.evidenceGroupIds
        .map((groupId) => params.evidence.groups.find((group) => group.id === groupId))
        .filter((group): group is NonNullable<typeof group> => Boolean(group));
      return [
        `Section: ${section.title}`,
        ...groups.map((group) =>
          [
            `Purpose: ${group.purpose}`,
            `Path: ${group.path}`,
            group.heading ? `Heading: ${group.heading}` : "",
            `Summary: ${group.summary}`,
            ...group.snippets.slice(0, 2).map((snippet) => `Snippet: ${snippet}`),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");

  return [
    params.language === "en"
      ? "You are a technical documentation assistant. Rewrite only from the answer plan and evidence."
      : "你是技术文档助手。只能基于回答计划和证据重写答案。",
    `Question: ${params.question}`,
    `Plan kind: ${params.plan.kind}`,
    params.plan.mustMention.length > 0 ? `Must mention: ${params.plan.mustMention.join(", ")}` : "",
    params.plan.mustAvoid.length > 0 ? `Must avoid: ${params.plan.mustAvoid.join(", ")}` : "",
    "",
    "Answer plan and evidence:",
    sections,
    "",
    "Formatting rules:",
    "Use numbered lists for executable Steps.",
    "Use bullets only for summaries, notes, or key points.",
    params.documentAccessHits && params.documentAccessHits.length > 0
      ? renderProviderDocumentAccessGuidance({
          hits: params.documentAccessHits,
          expandedContexts: params.expandedDocumentContexts,
        })
      : "",
    "",
    "Draft answer:",
    params.draftAnswer,
    "",
    "Please stream the final answer between the sentinels below.",
    "FINAL_ANSWER_START",
    params.draftAnswer,
    "FINAL_ANSWER_END",
  ]
    .filter(Boolean)
    .join("\n");
}
