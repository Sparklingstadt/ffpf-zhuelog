// Trades a GitHub OAuth code (PKCE) for the GitHub user, as Go's GitHubClient
// (services/api/auth/github.go). The caller checks the OAuth state and builds
// the redirect URI; GitHub itself checks the code_verifier against the
// code_challenge (S256) sent with the authorize request.
//
// Outcomes: "invalid" when GitHub refuses the code, verifier or token;
// "unavailable" for transport and upstream failures. Neither the result nor
// the log ever carries the code, verifier, client secret or GitHub token.
import type {
  ExchangeOutcome,
  GitHubIdentity,
} from "@/application/identity/sign-in";

import {
  type OAuthLog,
  consoleOAuthLog,
  fetchLimited,
  loggableOAuthErrorCode,
} from "./oauth-http";

export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_API_URL = "https://api.github.com";

type ExchangeFailure = Extract<ExchangeOutcome<never>, { ok: false }>;

const INVALID = { ok: false, reason: "invalid" } as const;
const UNAVAILABLE = { ok: false, reason: "unavailable" } as const;

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// Go decodes into a struct of strings: a field that is present but not a
// string (null aside) fails the whole decode. null here means "not a string".
function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : null;
}

export function createGitHubOAuthClient(config: {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch; // tests
  tokenUrl?: string; // tests only; never from the environment
  apiUrl?: string; // tests only
  timeoutMs?: number; // tests
  log?: OAuthLog;
}) {
  const fetchFn = config.fetch ?? fetch;
  const tokenUrl = config.tokenUrl ?? GITHUB_TOKEN_URL;
  const userUrl =
    (config.apiUrl ?? GITHUB_API_URL).replace(/\/+$/, "") + "/user";
  const log = config.log ?? consoleOAuthLog;
  const options = { timeoutMs: config.timeoutMs };

  // Go: fetchToken.
  async function fetchToken(
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<{ ok: true; token: string } | ExchangeFailure> {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }).toString();
    const response = await fetchLimited(
      fetchFn,
      tokenUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
      },
      options,
    );
    if (response === "unavailable" || response.status !== 200)
      return UNAVAILABLE;
    const json = parseJsonObject(response.text);
    if (!json) return UNAVAILABLE;
    const error = optionalString(json.error);
    const accessToken = optionalString(json.access_token);
    if (error === null || accessToken === null) return UNAVAILABLE;
    if (error !== "") {
      log("GITHUB_TOKEN_REJECTED", {
        github_error: loggableOAuthErrorCode(error),
      });
      return INVALID;
    }
    if (!accessToken) return UNAVAILABLE;
    return { ok: true, token: accessToken };
  }

  // Go: fetchUser.
  async function fetchUser(
    token: string,
  ): Promise<ExchangeOutcome<GitHubIdentity>> {
    const response = await fetchLimited(
      fetchFn,
      userUrl,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      options,
    );
    if (response === "unavailable") return UNAVAILABLE;
    if (response.status === 401 || response.status === 403) return INVALID;
    if (response.status < 200 || response.status > 299) return UNAVAILABLE;
    const json = parseJsonObject(response.text);
    if (!json) return UNAVAILABLE;
    const { id, login } = json;
    if (
      typeof id !== "number" ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      typeof login !== "string" ||
      login === ""
    )
      return UNAVAILABLE;
    return { ok: true, user: { id, login } };
  }

  return {
    // Go: GitHubClient.Exchange. Empty code or verifier is refused without
    // calling GitHub.
    async exchange(
      code: string,
      verifier: string,
      redirectUri: string,
    ): Promise<ExchangeOutcome<GitHubIdentity>> {
      if (code === "" || verifier === "") return INVALID;
      const token = await fetchToken(code, verifier, redirectUri);
      if (!token.ok) return token;
      return fetchUser(token.token);
    },
  };
}
