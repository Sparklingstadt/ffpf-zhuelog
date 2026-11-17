// HTTP helpers shared by the OAuth clients (GitHub, FFPF ID), as Go's
// services/api/httpclient.NoRedirect and the clients' `do` helpers
// (auth/github.go, auth/ffpf.go): no redirects, 10 s, 1 MiB.

export const OAUTH_TIMEOUT_MS = 10_000;
export const OAUTH_MAX_BODY_BYTES = 1_048_576;

// A logger for fixed codes: console.warn(code, fields). Fields carry only
// fixed words, HTTP statuses and loggableOAuthErrorCode output.
export type OAuthLog = (
  code: string,
  fields?: Record<string, string | number>,
) => void;

export const consoleOAuthLog: OAuthLog = (code, fields) => {
  if (fields) console.warn(code, fields);
  else console.warn(code);
};

const OAUTH_ERROR_CODE = /^[a-z_]{1,64}$/;

// Go: loggableOAuthErrorCode. The code when it matches ^[a-z_]{1,64}$, else
// "unrecognized", so an answer that echoes a secret never reaches the log.
export function loggableOAuthErrorCode(code: unknown): string {
  return typeof code === "string" && OAUTH_ERROR_CODE.test(code)
    ? code
    : "unrecognized";
}

const HEX = "0123456789ABCDEF";

function isUnreserved(byte: number): boolean {
  return (
    (byte >= 0x30 && byte <= 0x39) || // 0-9
    (byte >= 0x41 && byte <= 0x5a) || // A-Z
    (byte >= 0x61 && byte <= 0x7a) || // a-z
    byte === 0x2d || // -
    byte === 0x2e || // .
    byte === 0x5f || // _
    byte === 0x7e // ~
  );
}

// Go: url.QueryEscape (unreserved kept, space as "+", everything else %XX
// upper case), over the UTF-8 bytes.
export function formUrlEncode(value: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(value)) {
    if (isUnreserved(byte)) out += String.fromCharCode(byte);
    else if (byte === 0x20) out += "+";
    else out += `%${HEX[byte >> 4]}${HEX[byte & 0x0f]}`;
  }
  return out;
}

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const out = new Uint8Array(maxBytes);
  let length = 0;
  if (!response.body) return out.subarray(0, 0);
  const reader = response.body.getReader();
  try {
    while (length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, maxBytes - length);
      out.set(value.subarray(0, take), length);
      length += take;
    }
  } finally {
    // The rest is dropped, as Go's io.LimitReader leaves it unread.
    reader.cancel().catch(() => {});
  }
  return out.subarray(0, length);
}

// One request that never follows redirects (a 3xx comes back as the
// response), times out after timeoutMs (the body read included, as Go's
// http.Client.Timeout), and reads at most maxBytes of the body (the rest is
// dropped, as Go's LimitReader). "unavailable" for a network error, a timeout
// or a body read error; the cause is never kept, as it can carry request
// details.
export async function fetchLimited(
  fetchFn: typeof fetch,
  url: string,
  init: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
  },
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ status: number; text: string } | "unavailable"> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? OAUTH_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      redirect: "manual",
      cache: "no-store",
      signal,
    });
    const bytes = await readLimited(
      response,
      options.maxBytes ?? OAUTH_MAX_BODY_BYTES,
    );
    return { status: response.status, text: new TextDecoder().decode(bytes) };
  } catch {
    return "unavailable";
  }
}
