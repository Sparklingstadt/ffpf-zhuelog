import { goApiUrl, isSafeGoApiUrl } from "@/infrastructure/config/environment";
import { readAccessToken } from "@/infrastructure/go-api/go-api-session";
import { handleChatRelay } from "@/presentation/controllers/chat-relay-controller";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleChatRelay(request, {
    accessToken: await readAccessToken(),
    fetchGo: async (path, init) => {
      // Tokens only ever go to an HTTPS URL, or to this machine over HTTP.
      const base = goApiUrl();
      if (!base || !isSafeGoApiUrl(base)) throw new Error("Go API unavailable");
      return fetch(base + path, {
        ...init,
        cache: "no-store",
        // A redirect must never carry the token to another URL.
        redirect: "error",
        signal: request.signal,
      });
    },
  });
}
