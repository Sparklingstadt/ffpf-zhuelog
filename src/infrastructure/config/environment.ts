import { normalizeLoginId } from "@/domain/identity/password-account";
import { trimWhiteSpace } from "@/domain/line/white-space";
import { normalizeLineOfficialAccountId } from "@/domain/line/official-account";

// Secrets travel to these URLs (the Sparklingstadt ID issuer), so they must be HTTPS
// unless they are this machine (local development and e2e).
export function isHttpsOrLoopbackUrl(raw: string): boolean {
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

// Sparklingstadt ID sign-in needs the Sparklingstadt ID server's issuer (the authorize, token and JWKS
// URLs are built from it), this service's client id and its client secret
// (trimmed of surrounding whitespace). Without all
// three, the Sparklingstadt ID button is not shown. The issuer must be HTTPS unless it
// is this machine (local development and e2e).
export function sidConfig():
  { issuer: string; clientId: string; clientSecret: string } | undefined {
  const issuer = process.env.SID_ISSUER?.trim().replace(/\/+$/, "");
  const clientId = process.env.SID_CLIENT_ID?.trim();
  const clientSecret = trimWhiteSpace(process.env.SID_CLIENT_SECRET ?? "");
  if (!issuer || !clientId || !clientSecret || !isHttpsOrLoopbackUrl(issuer))
    return undefined;
  return { issuer, clientId, clientSecret };
}

// sidConfig in the form the Better Auth configuration takes: null when
// Sparklingstadt ID is not configured, and the "sid" provider is then left out.
export function sidOAuthConfig(): {
  issuer: string;
  clientId: string;
  clientSecret: string;
} | null {
  return sidConfig() ?? null;
}

// Better Auth's secret (BETTER_AUTH_SECRET, trimmed of Unicode White_Space).
// Required: it signs the session cookies, so throws when unset or blank.
export function betterAuthSecret(): string {
  const secret = trimWhiteSpace(process.env.BETTER_AUTH_SECRET ?? "");
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return secret;
}

// The demo account's password (DEMO_PASSWORD, trimmed of Unicode
// White_Space): the demo button signs in with it and the demo reset sets it
// again. Undefined when blank, and there is then no demo.
export function demoPassword(): string | undefined {
  const password = trimWhiteSpace(process.env.DEMO_PASSWORD ?? "");
  return password ? password : undefined;
}

// The demo account: DEMO_LOGIN_ID and DEMO_PASSWORD. Undefined unless both
// are set; there is then no demo (no demo button, and /api/cron/demo-reset
// answers 404).
export function demoConfig():
  { loginId: string; password: string } | undefined {
  const loginId = demoLoginId();
  const password = demoPassword();
  return loginId && password ? { loginId, password } : undefined;
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

// The site's public origin, for the absolute URLs that OGP, the sitemap and
// robots.txt need. AUTH_URL already names it (its path is ignored); without
// one, Vercel's production domain, then the local dev server.
export function siteUrl(): string {
  const configured = process.env.AUTH_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.protocol === "http:")
        return url.origin;
    } catch {
      // A malformed AUTH_URL falls through to the defaults.
    }
  }
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

let demoLoginIdReported = false;

// Login id of the demo password account, when one is configured. It must
// already be a login id: trimmed, then unchanged by normalizeLoginId (3 to 32
// of a-z, 0-9, '.', '_' and '-'). The web cannot refuse to start over a bad
// value, so it offers no demo and says so once, without the value.
export function demoLoginId(): string | undefined {
  const raw = trimWhiteSpace(process.env.DEMO_LOGIN_ID ?? "");
  if (!raw) return undefined;
  if (normalizeLoginId(raw) === raw) return raw;
  if (!demoLoginIdReported) {
    demoLoginIdReported = true;
    console.error("DEMO_LOGIN_ID_INVALID");
  }
  return undefined;
}

export type OpenAiConfig = {
  apiKey: string;
  baseUrl: string;
  learningModel: string;
  // The quick questions' (and the chat's) model; also the modelName of a
  // saved question note.
  chatModel: string;
};

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
const DEFAULT_LEARNING_MODEL = "gpt-5-mini";
const DEFAULT_CHAT_MODEL = "gpt-6.1-sol";

// The API key travels to the base URL, so an override must be an http(s)
// loopback URL (for tests). Without a key, or with any other override,
// OpenAI is treated as not configured.
export function openAiConfig(): OpenAiConfig | undefined {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return undefined;
  const override = process.env.OPENAI_API_BASE_URL?.trim();
  let baseUrl = DEFAULT_OPENAI_BASE_URL;
  if (override) {
    if (!isLoopbackHttpUrl(override)) return undefined;
    baseUrl = override;
  }
  const learningModel =
    process.env.OPENAI_LEARNING_MODEL?.trim() || DEFAULT_LEARNING_MODEL;
  const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
  return { apiKey, baseUrl, learningModel, chatModel };
}

// Whether an OpenAI API key is set at all, to tell "not configured" from a
// rejected OPENAI_API_BASE_URL.
export function openAiKeySet(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export type LineConfig = {
  channelSecret: string;
  accessToken: string;
  apiBaseUrl: string;
};

const DEFAULT_LINE_API_BASE_URL = "https://api.line.me";

// LINE works only with both LINE values and OpenAI configured; a partial set
// turns LINE off. Values are trimmed of Unicode White_Space.
// LINE_API_BASE_URL is for tests: the access token travels to it, so it must
// be an http(s) loopback URL; anything else means not configured.
export function lineConfig(): LineConfig | undefined {
  const channelSecret = trimWhiteSpace(process.env.LINE_CHANNEL_SECRET ?? "");
  const accessToken = trimWhiteSpace(
    process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  );
  if (!channelSecret || !accessToken || !openAiConfig()) return undefined;
  const override = trimWhiteSpace(process.env.LINE_API_BASE_URL ?? "");
  if (override && !isLoopbackHttpUrl(override)) return undefined;
  return {
    channelSecret,
    accessToken,
    apiBaseUrl: override || DEFAULT_LINE_API_BASE_URL,
  };
}

// The secret Vercel Cron presents (CRON_SECRET, trimmed); undefined when
// unset, and every cron call is then refused.
export function cronSecret(): string | undefined {
  const secret = trimWhiteSpace(process.env.CRON_SECRET ?? "");
  return secret ? secret : undefined;
}

function isLoopbackHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  return ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
}
