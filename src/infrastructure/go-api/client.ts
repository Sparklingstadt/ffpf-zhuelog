import { goApiUrl } from "../config/environment";

export type GoTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
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
  if (init.clientIp) {
    headers["X-Zhuelog-Client-IP"] = init.clientIp;
    headers["X-Zhuelog-Proxy-Secret"] = process.env.API_WEB_PROXY_SECRET ?? "";
  }

  let response: Response;
  try {
    response = await fetch(base + path, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new GoApiError(0, "unavailable");
  }

  if (!response.ok)
    throw new GoApiError(response.status, await errorCode(response));
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
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

export function logout(refreshToken: string) {
  return goApi<void>("/v1/auth/logout", {
    method: "POST",
    body: { refreshToken },
  });
}

export function fetchMe(accessToken: string) {
  return goApi<GoMe>("/v1/me", { method: "GET", accessToken });
}
