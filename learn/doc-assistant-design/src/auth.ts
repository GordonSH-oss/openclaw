export function isAdminToken(token: string | undefined, adminToken: string | undefined): boolean {
  const normalizedToken = token?.trim();
  const normalizedAdminToken = adminToken?.trim();
  if (!normalizedToken || !normalizedAdminToken) {
    return false;
  }
  return normalizedToken === normalizedAdminToken;
}

export function resolveScopesFromToken(
  token: string | undefined,
  adminToken: string | undefined,
): string[] {
  return isAdminToken(token, adminToken) ? ["admin", "read"] : ["read"];
}
