// Base URL of the Go API, without surrounding spaces or a trailing slash.
export function goApiUrl(): string | undefined {
  const url = process.env.GO_API_URL?.trim().replace(/\/+$/, "");
  return url ? url : undefined;
}

// Matches the Go API's own minimum for API_WEB_PROXY_SECRET.
const MIN_PROXY_SECRET_BYTES = 32;

// Sign-in goes through the Go API, so it needs the API's URL, the proxy
// secret it shares with the web, and the GitHub OAuth App's client id.
export function isAuthConfigured(): boolean {
  const url = goApiUrl();
  const secret = process.env.API_WEB_PROXY_SECRET ?? "";
  return Boolean(
    url &&
    isSafeGoApiUrl(url) &&
    new TextEncoder().encode(secret).length >= MIN_PROXY_SECRET_BYTES &&
    process.env.AUTH_GITHUB_ID,
  );
}

// The proxy secret and tokens travel to GO_API_URL, so it must be HTTPS
// unless it is this machine (local development and e2e).
export function isSafeGoApiUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}
