import { goApiUrl, isSafeGoApiUrl } from "@/infrastructure/config/environment";
import { readAccessToken } from "@/infrastructure/go-api/go-api-session";
import {
  handleChatRelay,
  type ChatRelayDeps,
} from "@/presentation/controllers/chat-relay-controller";

// The POST handler of a route that relays a chat to Go and streams the
// answer back. Both chat routes share it, so a fix to how the token is sent
// lands in one place.
export function chatRelayRoute(upstreamPath?: ChatRelayDeps["upstreamPath"]) {
  return async function POST(request: Request) {
    return handleChatRelay(request, {
      upstreamPath,
      accessToken: await readAccessToken(),
      fetchGo: async (path, init) => {
        // Tokens only ever go to an HTTPS URL, or to this machine over HTTP.
        const base = goApiUrl();
        if (!base || !isSafeGoApiUrl(base))
          throw new Error("Go API unavailable");
        return fetch(base + path, {
          ...init,
          cache: "no-store",
          // A redirect must never carry the token to another URL.
          redirect: "error",
          signal: request.signal,
        });
      },
    });
  };
}
