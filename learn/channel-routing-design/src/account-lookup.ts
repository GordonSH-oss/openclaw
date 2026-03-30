export const DEFAULT_LEARNING_ACCOUNT_ID = "default";

export function normalizeLearningAccountId(accountId?: string | null): string {
  const normalized = (accountId ?? "").trim().toLowerCase();
  return normalized || DEFAULT_LEARNING_ACCOUNT_ID;
}

export function resolveLearningDefaultAccount(params: {
  requestedAccountId?: string | null;
  configuredAccounts?: string[];
  defaultAccountId?: string;
}): string {
  if (params.requestedAccountId?.trim()) {
    return normalizeLearningAccountId(params.requestedAccountId);
  }
  if (params.defaultAccountId?.trim()) {
    return normalizeLearningAccountId(params.defaultAccountId);
  }
  if (params.configuredAccounts?.length) {
    return normalizeLearningAccountId(params.configuredAccounts[0]);
  }
  return DEFAULT_LEARNING_ACCOUNT_ID;
}
