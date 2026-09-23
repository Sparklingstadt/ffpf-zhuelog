export const CODEX_LOCAL_MODEL = "gpt-5.6-sol";

export function isCodexLocalRequested() {
  return process.env.CHAT_PROVIDER === "codex-local";
}

export function isCodexLocalEnabled() {
  return (
    isCodexLocalRequested() &&
    process.env.NODE_ENV === "development" &&
    !process.env.VERCEL
  );
}

// Loopback binding (dev:codex), Auth.js admin checks and these headers are
// complementary. Never run this prototype behind a tunnel or reverse proxy.
export function isLocalChatRequest(request: Request) {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const host = request.headers.get("host") ?? "";
    // Next dev normalizes Request.url to localhost even when the browser uses
    // 127.0.0.1. Validate the original Host strictly, then compare that to Origin.
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return false;
    const browserUrl = new URL(`${url.protocol}//${host}`);
    return (
      isCodexLocalEnabled() &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      browserUrl.port === url.port &&
      origin === browserUrl.origin &&
      !request.headers.has("forwarded") &&
      [null, host].includes(request.headers.get("x-forwarded-host")) &&
      [null, "same-origin"].includes(request.headers.get("sec-fetch-site"))
    );
  } catch {
    return false;
  }
}
