import { goApiUrl, isSafeGoApiUrl } from "../config/environment";

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
  // Only while an admin acts as a member (X-Zhuelog-Act-As).
  actingAs?: GoActingAs;
};

export type GoActingAs = {
  ownerId: string;
  loginId: string;
  displayName: string;
};

// status 0 with code "unavailable" means the API was unreachable or timed out.
// Error.message never carries tokens, passwords or the proxy secret. The Go
// API's own text (Japanese, meant for the user) is kept apart in userMessage
// so it does not end up in logs; it is "" when the response had none.
export class GoApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly userMessage = "",
  ) {
    super(`Go API error ${status} ${code}`);
    this.name = "GoApiError";
  }
}

const TIMEOUT_MS = 10_000;
// CSV imports may take up to 4 minutes 30 seconds.
const UPLOAD_TIMEOUT_MS = 270_000;

type CallerInit = {
  accessToken?: string;
  clientIp?: string;
  // The member an admin acts as. Go only honours it with an admin token.
  actAs?: string;
};

export type GoApiInit = CallerInit & {
  method: string;
  body?: unknown;
};

// Reads the base URL, secret and fetch at call time so tests can swap them.
export function goApi<T>(path: string, init: GoApiInit): Promise<T> {
  return send<T>(path, {
    method: init.method,
    headers: { "content-type": "application/json", ...callerHeaders(init) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    timeoutMs: TIMEOUT_MS,
  });
}

// multipart/form-data: fetch sets content-type itself, with the boundary.
export function goUpload<T>(
  path: string,
  form: FormData,
  init: CallerInit & { method?: string },
): Promise<T> {
  return send<T>(path, {
    method: init.method ?? "POST",
    headers: callerHeaders(init),
    body: form,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
}

function callerHeaders(init: CallerInit): Record<string, string> {
  const headers: Record<string, string> = {};
  if (init.accessToken) headers.authorization = `Bearer ${init.accessToken}`;
  if (init.accessToken && init.actAs) headers["X-Zhuelog-Act-As"] = init.actAs;
  // The IP is only trusted by Go together with the secret, so send both or neither.
  const secret = process.env.API_WEB_PROXY_SECRET;
  if (init.clientIp && secret) {
    headers["X-Zhuelog-Client-IP"] = init.clientIp;
    headers["X-Zhuelog-Proxy-Secret"] = secret;
  }
  return headers;
}

async function send<T>(
  path: string,
  request: {
    method: string;
    headers: Record<string, string>;
    body: BodyInit | undefined;
    timeoutMs: number;
  },
): Promise<T> {
  // Tokens and the proxy secret only ever go to an HTTPS URL, or to this
  // machine over HTTP; any other GO_API_URL is treated as unreachable.
  const base = goApiUrl();
  if (!base || !isSafeGoApiUrl(base)) throw new GoApiError(0, "unavailable");

  const signal = AbortSignal.timeout(request.timeoutMs);
  let response: Response;
  try {
    response = await fetch(base + path, {
      method: request.method,
      headers: request.headers,
      body: request.body,
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

  if (!response.ok) {
    const { code, message } = errorBody(text);
    throw new GoApiError(response.status, code, message);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GoApiError(response.status, "unknown");
  }
}

function errorBody(text: string): { code: string; message: string } {
  try {
    const body = JSON.parse(text) as {
      error?: { code?: unknown; message?: unknown };
    };
    const code = body?.error?.code;
    const message = body?.error?.message;
    return {
      code: typeof code === "string" && code ? code : "unknown",
      message: typeof message === "string" ? message : "",
    };
  } catch {
    return { code: "unknown", message: "" };
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

export function fetchMe(accessToken: string, actAs?: string) {
  return goApi<GoMe>("/v1/me", { method: "GET", accessToken, actAs });
}
