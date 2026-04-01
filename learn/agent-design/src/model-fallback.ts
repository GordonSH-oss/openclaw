import type { ModelCandidate } from "./types.js";

export type FallbackReason = "timeout" | "rate_limit" | "auth" | "unknown";

export class ModelFallbackError extends Error {
  readonly reason: FallbackReason;
  readonly provider: string;
  readonly model: string;

  constructor(message: string, reason: FallbackReason, provider: string, model: string) {
    super(message);
    this.name = "ModelFallbackError";
    this.reason = reason;
    this.provider = provider;
    this.model = model;
  }
}

export class ModelFallbackSummaryError extends Error {
  readonly attempts: Array<{
    provider: string;
    model: string;
    ok: boolean;
    reason?: string;
  }>;

  constructor(
    message: string,
    attempts: Array<{ provider: string; model: string; ok: boolean; reason?: string }>,
  ) {
    super(message);
    this.name = "ModelFallbackSummaryError";
    this.attempts = attempts;
  }
}

export function resolveModelCandidates(params: {
  provider?: string;
  model?: string;
}): ModelCandidate[] {
  const primary = {
    provider: params.provider ?? "mock",
    model: params.model ?? "learning-primary",
    reason: "primary" as const,
  };
  const fallback = {
    provider: params.provider ?? "mock",
    model: "learning-backup",
    reason: "fallback" as const,
  };
  if (primary.model === fallback.model) {
    return [primary];
  }
  return [primary, fallback];
}

export async function runWithModelFallback<T>(params: {
  candidates: ModelCandidate[];
  run: (candidate: ModelCandidate, attempt: number) => Promise<T>;
}): Promise<{
  result: T;
  selected: ModelCandidate;
  attempts: Array<{ provider: string; model: string; ok: boolean; reason?: string }>;
}> {
  const attempts: Array<{ provider: string; model: string; ok: boolean; reason?: string }> = [];

  for (const [index, candidate] of params.candidates.entries()) {
    try {
      const result = await params.run(candidate, index);
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        ok: true,
      });
      return { result, selected: candidate, attempts };
    } catch (error) {
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        ok: false,
        reason:
          error instanceof ModelFallbackError
            ? error.reason
            : error instanceof Error
              ? error.message
              : String(error),
      });
      if (!(error instanceof ModelFallbackError)) {
        throw error;
      }
    }
  }

  throw new ModelFallbackSummaryError(
    `All model candidates failed: ${attempts.map((entry) => `${entry.model}:${entry.reason}`).join(", ")}`,
    attempts,
  );
}
