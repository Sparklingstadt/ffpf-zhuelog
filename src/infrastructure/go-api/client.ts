import { goApiUrl } from "../config/environment";

export type GoTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  // The refresh token's lifetime in seconds (30 days, or 24 hours for guests).
  refreshExpiresIn?: number;
};

export type GoMe = {
  ownerId: string;
  role: "admin" | "member" | "guest";
  login: string;
  displayName?: string;
  accountId?: string;
};

// status 0 with code "unavailable" means the API was unreachable or timed out.
// Messages never carry tokens, passwords or the proxy secret.
export class GoApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Go API error ${status} ${code}`);
    this.name = "GoApiError";
  }
}

const TIMEOUT_MS = 10_000;

// Reads the base URL, secret and fetch at call time so tests can swap them.
export async function goApi<T>(
  path: string,
  init: {
    method: string;
    body?: unknown;
    accessToken?: string;
    clientIp?: string;
  },
): Promise<T> {
  const base = goApiUrl();
  if (!base) throw new GoApiError(0, "unavailable");

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init.accessToken) headers.authorization = `Bearer ${init.accessToken}`;
  // The IP is only trusted by Go together with the secret, so send both or neither.
  const secret = process.env.API_WEB_PROXY_SECRET;
  if (init.clientIp && secret) {
    headers["X-Zhuelog-Client-IP"] = init.clientIp;
    headers["X-Zhuelog-Proxy-Secret"] = secret;
  }

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(base + path, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      // A redirect must never carry the proxy secret to another URL.
      redirect: "error",
      signal,
    });
  } catch {
    throw new GoApiError(0, "unavailable");
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    // Timeouts and aborts while reading the body count as unreachable.
    if (signal.aborted) throw new GoApiError(0, "unavailable");
    throw new GoApiError(response.status, "unknown");
  }

  if (!response.ok) throw new GoApiError(response.status, errorCode(text));
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GoApiError(response.status, "unknown");
  }
}

function errorCode(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { code?: unknown } };
    const code = body?.error?.code;
    return typeof code === "string" && code ? code : "unknown";
  } catch {
    return "unknown";
  }
}

export function loginPassword(
  loginId: string,
  password: string,
  clientIp: string,
) {
  return goApi<GoTokens>("/v1/auth/password", {
    method: "POST",
    body: { loginId, password },
    clientIp,
  });
}

export function loginGuest(clientIp: string) {
  return goApi<GoTokens>("/v1/auth/guest", {
    method: "POST",
    body: {},
    clientIp,
  });
}

export function loginGitHub(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientIp: string,
) {
  return goApi<GoTokens>("/v1/auth/github", {
    method: "POST",
    body: { code, codeVerifier, redirectUri },
    clientIp,
  });
}

export function refreshTokens(refreshToken: string, clientIp: string) {
  return goApi<GoTokens>("/v1/auth/refresh", {
    method: "POST",
    body: { refreshToken },
    clientIp,
  });
}

export function logout(refreshToken: string, clientIp: string) {
  return goApi<void>("/v1/auth/logout", {
    method: "POST",
    body: { refreshToken },
    clientIp,
  });
}

export function fetchMe(accessToken: string) {
  return goApi<GoMe>("/v1/me", { method: "GET", accessToken });
}
