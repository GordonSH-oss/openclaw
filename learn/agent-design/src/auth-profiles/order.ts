import type { AuthProfileOrderResult } from "../types.js";
import type { AuthProfileStore } from "./store.js";

export function resolveAuthProfileOrder(params: {
  store: AuthProfileStore;
  provider: string;
  preferredProfile?: string;
  now?: number;
}): AuthProfileOrderResult {
  const now = params.now ?? Date.now();
  const candidates = Object.values(params.store.profiles).filter(
    (profile) => profile.provider === params.provider,
  );

  const available: string[] = [];
  const cooledDown: Array<{ id: string; until: number }> = [];

  for (const profile of candidates) {
    const usage = params.store.usage[profile.id];
    if (usage?.cooldownUntil && usage.cooldownUntil > now) {
      cooledDown.push({ id: profile.id, until: usage.cooldownUntil });
      continue;
    }
    available.push(profile.id);
  }

  available.sort((a, b) => {
    const aUsage = params.store.usage[a]?.lastUsed ?? 0;
    const bUsage = params.store.usage[b]?.lastUsed ?? 0;
    return aUsage - bUsage;
  });
  cooledDown.sort((a, b) => a.until - b.until);

  const ordered = [...available, ...cooledDown.map((entry) => entry.id)];
  if (params.preferredProfile && ordered.includes(params.preferredProfile)) {
    return {
      orderedProfileIds: [
        params.preferredProfile,
        ...ordered.filter((entry) => entry !== params.preferredProfile),
      ],
      cooledDownProfileIds: cooledDown.map((entry) => entry.id),
    };
  }

  return {
    orderedProfileIds: ordered,
    cooledDownProfileIds: cooledDown.map((entry) => entry.id),
  };
}

export function markAuthProfileFailure(params: {
  store: AuthProfileStore;
  profileId: string;
  reason: "timeout" | "rate_limit" | "auth";
  now?: number;
}): void {
  const now = params.now ?? Date.now();
  const cooldownMs =
    params.reason === "auth" ? 10 * 60_000 : params.reason === "rate_limit" ? 60_000 : 30_000;
  params.store.usage[params.profileId] = {
    ...(params.store.usage[params.profileId] ?? {}),
    cooldownUntil: now + cooldownMs,
    lastFailureReason: params.reason,
  };
}

export function markAuthProfileSuccess(params: {
  store: AuthProfileStore;
  profileId: string;
  now?: number;
}): void {
  const now = params.now ?? Date.now();
  params.store.usage[params.profileId] = {
    ...(params.store.usage[params.profileId] ?? {}),
    lastUsed: now,
    cooldownUntil: undefined,
    lastFailureReason: undefined,
  };
}
