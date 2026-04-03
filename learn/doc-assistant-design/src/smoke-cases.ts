export type DocAssistantSmokeCase = {
  id: string;
  turns: string[];
};

export const DOC_ASSISTANT_SMOKE_CASES: DocAssistantSmokeCase[] = [
  { id: "greeting", turns: ["Hello"] },
  { id: "platform-clarification", turns: ["How to start a direct chat?"] },
  { id: "channel-kind-clarification", turns: ["How to create a channel?"] },
  { id: "api-layer-clarification", turns: ["How to connect?"] },
  { id: "concept-answer", turns: ["What is community channel?"] },
  { id: "procedural-answer", turns: ["How to send a message on Android?"] },
  { id: "mixed-answer", turns: ["What is community channel? How to create a community channel?"] },
  { id: "follow-up-continuation", turns: ["How to send my first message?", "Android"] },
];
