import type { DocSearchHit } from "./protocol/index.js";
import {
  extractQuestionAnchors,
  selectRequiredAnchors,
  summarizeAnchorFocus,
  type QuestionAnchors,
} from "./question-anchors.js";
import {
  buildQuestionState,
  type QuestionChannelKind,
  type QuestionPlatform,
  type QuestionState,
} from "./question-state.js";
import { normalizeSearchText } from "./search-text.js";

export type TaskResponseMode =
  | "definition"
  | "procedure"
  | "mixed"
  | "clarification"
  | "insufficient";

export type TaskFrame = {
  intent: QuestionState["intent"];
  product?: QuestionState["product"];
  platform?: QuestionPlatform;
  apiLayer?: QuestionState["apiLayer"];
  channelKind?: QuestionChannelKind;
  anchors: {
    focus: string[];
    verbs: string[];
    constraints: string[];
    apiSymbols: string[];
  };
  coverage?: {
    matched: string[];
    missing: string[];
  };
  responseMode: TaskResponseMode;
};

export type EvidenceLabel =
  | "setup"
  | "connect"
  | "navigate"
  | "overview"
  | "definition"
  | "procedure"
  | "event"
  | "reference"
  | "server_only"
  | "client_only";

export type EvidenceDescriptor = {
  labels: EvidenceLabel[];
  anchors: QuestionAnchors;
};

function normalizeTaskFrameText(text: string): string {
  return normalizeSearchText(text)
    .replace(/\bjavascript\b/g, "web")
    .replace(/\bjs\b/g, "web")
    .replace(/\bdirectchannel\b/g, "direct channel")
    .replace(/\bgroupchannel\b/g, "group channel")
    .replace(/\bopenchannel\b/g, "open channel")
    .replace(/\bdms?\b/g, "direct channel")
    .replace(/\bdirect messages?\b/g, "direct channel")
    .replace(/\bprivate messages?\b/g, "direct channel")
    .replace(/\bdirect chats?\b/g, "direct channel")
    .replace(/\bprivate chats?\b/g, "direct channel")
    .replace(/\bsingle chats?\b/g, "direct channel")
    .replace(/\b1[\s\-_/]*to[\s\-_/]*1\b/g, "one to one")
    .replace(/\b1[\s\-_/]*on[\s\-_/]*1\b/g, "one to one")
    .trim();
}

function dedupe(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).filter(Boolean);
}

function collectEvidenceAnchors(descriptors: EvidenceDescriptor[]): string[] {
  return dedupe(
    descriptors.flatMap((descriptor) => [
      ...descriptor.anchors.verbPhrases,
      ...descriptor.anchors.nounPhrases,
      ...descriptor.anchors.qualifiers,
      ...descriptor.anchors.constraints,
      ...descriptor.anchors.apiSymbols,
      ...descriptor.anchors.unknownTerms,
    ]),
  );
}

export function labelEvidenceHit(
  hit: Pick<DocSearchHit, "path" | "heading" | "text">,
): EvidenceDescriptor {
  const normalized = normalizeTaskFrameText([hit.path, hit.heading ?? "", hit.text].join("\n"));
  const normalizedHeadingPath = normalizeTaskFrameText([hit.path, hit.heading ?? ""].join("\n"));
  const normalizedBody = normalizeTaskFrameText(hit.text);
  const anchors = extractQuestionAnchors([hit.path, hit.heading ?? "", hit.text].join("\n"));
  const labels = new Set<EvidenceLabel>();

  if (
    normalizedHeadingPath.includes("about ") ||
    normalizedHeadingPath.startsWith("what is ") ||
    normalizedHeadingPath.startsWith("what are ") ||
    normalizedHeadingPath.includes("glossary") ||
    normalizedBody.includes(" is a ") ||
    normalizedBody.includes(" are ") ||
    normalizedBody.includes(" refers to ")
  ) {
    labels.add("definition");
  }

  if (
    normalizedHeadingPath.includes("overview") ||
    normalizedHeadingPath.includes("getting started") ||
    normalizedHeadingPath.includes("quickstart")
  ) {
    labels.add("overview");
  }

  if (
    normalizedHeadingPath.includes("import") ||
    normalizedHeadingPath.includes("initialize") ||
    normalizedHeadingPath.includes("set up") ||
    normalizedHeadingPath.includes("setup") ||
    normalizedHeadingPath.includes("prerequisites") ||
    normalizedHeadingPath.includes("requirements") ||
    normalizedBody.includes("install") ||
    normalizedBody.includes("initialize") ||
    normalizedBody.includes("set up") ||
    normalizedBody.includes("setup") ||
    normalizedBody.includes("getting started")
  ) {
    labels.add("setup");
  }

  if (
    normalizedHeadingPath.includes("connect") ||
    normalizedHeadingPath.includes("connection") ||
    normalizedBody.includes("ncengine connect") ||
    normalizedBody.includes("connect the user")
  ) {
    labels.add("connect");
  }

  if (
    normalizedHeadingPath.includes("push notification click") ||
    normalizedHeadingPath.includes("notification click") ||
    normalizedHeadingPath.includes("channel page") ||
    normalizedHeadingPath.includes("channel list page") ||
    normalizedBody.includes("intent filter") ||
    normalizedBody.includes("androidmanifest")
  ) {
    labels.add("navigate");
  }

  if (
    normalized.includes("onmessagedeleted") ||
    normalized.includes("messagehandler") ||
    (normalized.includes("event") && normalized.includes("message"))
  ) {
    labels.add("event");
  }

  if (
    normalized.includes("sendmessage") ||
    normalized.includes("sendtextmessageparams") ||
    normalized.includes("sendimagemessageparams") ||
    normalized.includes("sendfilemessageparams") ||
    normalized.includes("sendvoicemessageparams") ||
    normalized.includes("deletemessageforall") ||
    normalized.includes("recall") ||
    normalized.includes("create a group") ||
    normalized.includes("creating community channels") ||
    normalized.includes("thread") ||
    normalized.includes("mention") ||
    normalized.includes("reaction") ||
    normalized.includes("forward")
  ) {
    labels.add("procedure");
  }
  if (
    /\b(add|remove|issue|verify|return|call|use|set)\b/.test(normalized) &&
    (normalized.includes("endpoint") ||
      normalized.includes("server api") ||
      normalized.includes("header"))
  ) {
    labels.add("procedure");
  }
  if (anchors.verbPhrases.length > 0) {
    labels.add("procedure");
  }

  if (
    (normalized.includes("platform chat api") || normalized.includes("server api")) &&
    !normalized.includes("does not provide client side apis")
  ) {
    labels.add("server_only");
  }
  if (
    normalized.includes("sdk") ||
    normalized.includes("client sdk") ||
    normalized.includes("client side")
  ) {
    labels.add("client_only");
  }

  if (labels.size === 0) {
    labels.add("reference");
  }

  return {
    labels: Array.from(labels),
    anchors,
  };
}

export function buildTaskFrame(params: {
  question: string;
  state?: QuestionState;
  hits?: Array<Pick<DocSearchHit, "path" | "heading" | "text">>;
  responseMode?: TaskResponseMode;
}): TaskFrame {
  const state = params.state ?? buildQuestionState(params.question);
  const labeledHits = (params.hits ?? []).map((hit) => labelEvidenceHit(hit));
  const evidenceAnchors = collectEvidenceAnchors(labeledHits);
  const requiredAnchors = selectRequiredAnchors(state);
  const matched = requiredAnchors.filter(
    (anchor) =>
      evidenceAnchors.includes(anchor) ||
      evidenceAnchors.some((candidate) => candidate.includes(anchor) || anchor.includes(candidate)),
  );
  const missing = requiredAnchors.filter((anchor) => !matched.includes(anchor));
  const responseMode =
    params.responseMode ??
    (state.intent === "concept" ? "definition" : state.intent === "mixed" ? "mixed" : "procedure");

  return {
    intent: state.intent,
    product: state.product,
    platform: state.platform,
    apiLayer: state.apiLayer,
    channelKind: state.channelKind,
    anchors: {
      focus: summarizeAnchorFocus(state.anchors),
      verbs: state.anchors.verbPhrases,
      constraints: state.anchors.constraints,
      apiSymbols: state.anchors.apiSymbols,
    },
    coverage:
      params.hits && params.hits.length > 0
        ? {
            matched,
            missing,
          }
        : undefined,
    responseMode,
  };
}
