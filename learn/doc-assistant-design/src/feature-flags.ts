export type DocAssistantFeatureFlags = {
  questionState: boolean;
  clarificationPolicy: boolean;
  llmFollowUp: boolean;
  stagedRetrieval: boolean;
  evidencePack: boolean;
  validator: boolean;
  validatorDowngrade: boolean;
};

function parseFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  return !["0", "false", "off", "no"].includes(raw.toLowerCase());
}

export function getDocAssistantFeatureFlags(): DocAssistantFeatureFlags {
  return {
    questionState: parseFlag("DOC_ASSISTANT_FLAG_QUESTION_STATE", true),
    clarificationPolicy: parseFlag("DOC_ASSISTANT_FLAG_CLARIFICATION_POLICY", true),
    llmFollowUp: parseFlag("DOC_ASSISTANT_FLAG_LLM_FOLLOW_UP", true),
    stagedRetrieval: parseFlag("DOC_ASSISTANT_FLAG_STAGED_RETRIEVAL", true),
    evidencePack: parseFlag("DOC_ASSISTANT_FLAG_EVIDENCE_PACK", true),
    validator: parseFlag("DOC_ASSISTANT_FLAG_VALIDATOR", true),
    validatorDowngrade: parseFlag("DOC_ASSISTANT_FLAG_VALIDATOR_DOWNGRADE", true),
  };
}
