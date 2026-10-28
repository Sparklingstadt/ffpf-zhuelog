import { normalizeLineOfficialAccountId } from "@/domain/line/official-account";

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

// FFPF ID sign-in on the web needs the portal's issuer (to build the
// authorize URL) and this service's client id; the secret stays with the Go
// API. Without both, the FFPF ID button is not shown. The issuer must be
// HTTPS unless it is this machine (local development and e2e).
export function ffpfIdConfig():
  { issuer: string; clientId: string } | undefined {
  const issuer = process.env.FFPF_ID_ISSUER?.trim().replace(/\/+$/, "");
  const clientId = process.env.FFPF_ID_CLIENT_ID?.trim();
  if (!issuer || !clientId || !isSafeGoApiUrl(issuer)) return undefined;
  return { issuer, clientId };
}

// Link to add the LINE official account as a friend. It is shown as a link
// on the page, so only an https:// URL is used; anything else is ignored.
export function lineAddFriendUrl(): string | undefined {
  const url = process.env.LINE_ADD_FRIEND_URL?.trim();
  return url?.startsWith("https://") ? url : undefined;
}

export function lineOfficialAccountId(): string | undefined {
  return normalizeLineOfficialAccountId(process.env.LINE_OFFICIAL_ACCOUNT_ID);
}

export function isLineLinkPreview(): boolean {
  return process.env.LINE_LINK_PREVIEW_MODE === "true";
}
