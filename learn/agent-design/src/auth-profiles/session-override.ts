const sessionOverrides = new Map<string, string>();

export function setSessionAuthProfileOverride(sessionKey: string, profileId: string): void {
  sessionOverrides.set(sessionKey, profileId);
}

export function getSessionAuthProfileOverride(sessionKey: string): string | undefined {
  return sessionOverrides.get(sessionKey);
}

export function clearSessionAuthProfileOverride(sessionKey: string): void {
  sessionOverrides.delete(sessionKey);
}
