import type { EvidencePack } from "./evidence-pack.js";
import type { QuestionState } from "./question-state.js";

export type AnswerSectionPlan = {
  title: string;
  purpose: "definition" | "steps" | "apis" | "notes" | "clarification" | "insufficient";
  evidenceGroupIds: string[];
};

export type AnswerPlan = {
  kind: "concept" | "guide" | "mixed" | "clarification" | "insufficient";
  sections: AnswerSectionPlan[];
  mustMention: string[];
  mustAvoid: string[];
};

function findGroupIds(evidence: EvidencePack, purposes: string[]): string[] {
  return evidence.groups
    .filter((group) => purposes.includes(group.purpose))
    .map((group) => group.id);
}

export function buildAnswerPlan(params: {
  question: string;
  state: QuestionState;
  evidence: EvidencePack;
}): AnswerPlan {
  const mustMention = [
    params.state.platform,
    params.state.channelKind,
    params.state.apiLayer,
    params.state.referent,
  ].filter((value): value is string => Boolean(value));
  const mustAvoid = ["android", "ios", "web", "flutter"].filter(
    (platform) => platform !== params.state.platform,
  );

  if (params.evidence.groups.length === 0) {
    return {
      kind: "insufficient",
      sections: [{ title: "Insufficient evidence", purpose: "insufficient", evidenceGroupIds: [] }],
      mustMention,
      mustAvoid,
    };
  }

  if (params.state.intent === "concept") {
    return {
      kind: "concept",
      sections: [
        {
          title: "Definition",
          purpose: "definition",
          evidenceGroupIds: findGroupIds(params.evidence, ["definition", "overview"]),
        },
        {
          title: "Notes",
          purpose: "notes",
          evidenceGroupIds: findGroupIds(params.evidence, ["constraint", "overview"]),
        },
      ],
      mustMention,
      mustAvoid,
    };
  }

  if (params.state.intent === "mixed") {
    return {
      kind: "mixed",
      sections: [
        {
          title: "Definition",
          purpose: "definition",
          evidenceGroupIds: findGroupIds(params.evidence, ["definition", "overview"]),
        },
        {
          title: "Steps",
          purpose: "steps",
          evidenceGroupIds: findGroupIds(params.evidence, ["task_steps", "prerequisite"]),
        },
        {
          title: "Key APIs or docs",
          purpose: "apis",
          evidenceGroupIds: findGroupIds(params.evidence, ["api_reference"]),
        },
        {
          title: "Notes",
          purpose: "notes",
          evidenceGroupIds: findGroupIds(params.evidence, ["constraint", "overview"]),
        },
      ],
      mustMention,
      mustAvoid,
    };
  }

  return {
    kind: "guide",
    sections: [
      {
        title: "What you need",
        purpose: "notes",
        evidenceGroupIds: findGroupIds(params.evidence, ["prerequisite"]),
      },
      {
        title: "Steps",
        purpose: "steps",
        evidenceGroupIds: findGroupIds(params.evidence, ["task_steps", "overview"]),
      },
      {
        title: "Key APIs or docs",
        purpose: "apis",
        evidenceGroupIds: findGroupIds(params.evidence, ["api_reference"]),
      },
      {
        title: "Notes",
        purpose: "notes",
        evidenceGroupIds: findGroupIds(params.evidence, ["constraint", "overview"]),
      },
    ],
    mustMention,
    mustAvoid,
  };
}
