import type { LearningPluginCandidate } from "./discovery.js";

export type LearningPluginEnablementDecision = {
  candidate: LearningPluginCandidate;
  enabled: boolean;
  reason: "enabled" | "disabled" | "memory_slot_replaced";
};

export async function resolveLearningPluginEnablement(params: {
  candidates: LearningPluginCandidate[];
  disabledPluginIds?: string[];
  memoryPluginId?: string;
}): Promise<LearningPluginEnablementDecision[]> {
  const disabled = new Set(
    (params.disabledPluginIds ?? []).map((value) => value.trim()).filter(Boolean),
  );
  return params.candidates.map((candidate) => {
    if (disabled.has(candidate.manifest.id)) {
      return { candidate, enabled: false, reason: "disabled" as const };
    }
    if (
      candidate.manifest.slot === "memory" &&
      params.memoryPluginId &&
      candidate.manifest.id !== params.memoryPluginId
    ) {
      return { candidate, enabled: false, reason: "memory_slot_replaced" as const };
    }
    return {
      candidate,
      enabled: candidate.manifest.enabledByDefault !== false,
      reason: "enabled" as const,
    };
  });
}
