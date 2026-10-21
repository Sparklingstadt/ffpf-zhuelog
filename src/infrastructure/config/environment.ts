// Base URL of the Go API, without surrounding spaces or a trailing slash.
export function goApiUrl(): string | undefined {
  const url = process.env.GO_API_URL?.trim().replace(/\/+$/, "");
  return url ? url : undefined;
}

export function isGoAuthEnabled(): boolean {
  return goApiUrl() !== undefined;
}

export function isGoAuthConfigured(): boolean {
  return Boolean(
    goApiUrl() &&
    process.env.API_WEB_PROXY_SECRET &&
    process.env.AUTH_GITHUB_ID,
  );
}

export function isAuthConfigured() {
  if (isGoAuthEnabled()) return isGoAuthConfigured();
  return Boolean(
    process.env.AUTH_SECRET &&
    process.env.AUTH_GITHUB_ID &&
    process.env.AUTH_GITHUB_SECRET &&
    process.env.AUTH_ALLOWED_GITHUB_IDS,
  );
}
