import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";

// A stand-in for FFPF ID (ffpf-portal's OpenID Connect provider) for the e2e
// run. It serves exactly what the web and services/api/auth/ffpf.go use:
//
//   GET  /oauth/authorize  checks the client and redirect URI, remembers the
//                          PKCE challenge and nonce, and goes straight back to
//                          redirect_uri?code=stub&state=… (no login screen).
//   POST /oauth/token      client_secret_basic; checks the code (once only),
//                          redirect URI and PKCE verifier, and answers with an
//                          ES256 ID token for ffpfStubUser carrying the nonce.
//   GET  /oauth/jwks       the public key of this run's random P-256 key.
//
// Nothing leaves this machine, and the key exists only in this process.

export const ffpfStubUser = {
  sub: "e2estub01",
  email: "yukina@example.com",
  name: "雪菜",
};

export type FfpfStubOptions = {
  port: number;
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

const code = "stub";
const kid = "e2e-stub-key";

export function startFfpfOidcStub(
  options: FfpfStubOptions,
): Promise<{ close(): Promise<void> }> {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const jwks = JSON.stringify({
    keys: [{ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, use: "sig", kid }],
  });
  // The latest authorization request, which the code "stub" stands for.
  let pending: { challenge: string; nonce: string } | null = null;

  const idToken = (nonce: string) => {
    const now = Math.floor(Date.now() / 1000);
    const part = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${part({ alg: "ES256", typ: "JWT", kid })}.${part({
      iss: options.issuer,
      aud: options.clientId,
      iat: now,
      exp: now + 300,
      nonce,
      sub: ffpfStubUser.sub,
      email: ffpfStubUser.email,
      email_verified: true,
      name: ffpfStubUser.name,
    })}`;
    // JWS wants r‖s (RFC 7518 §3.4), not DER.
    const signature = sign("sha256", Buffer.from(unsigned), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    return `${unsigned}.${signature}`;
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", options.issuer);
    const json = (status: number, body: string) =>
      response
        .writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(body);

    if (request.method === "GET" && url.pathname === "/oauth/authorize") {
      const params = url.searchParams;
      if (
        params.get("response_type") !== "code" ||
        params.get("client_id") !== options.clientId ||
        params.get("redirect_uri") !== options.redirectUri ||
        params.get("code_challenge_method") !== "S256" ||
        !params.get("code_challenge") ||
        !params.get("nonce") ||
        !params.get("state") ||
        !params.get("scope")?.split(" ").includes("openid")
      ) {
        response.writeHead(400).end("invalid authorization request");
        return;
      }
      pending = {
        challenge: params.get("code_challenge")!,
        nonce: params.get("nonce")!,
      };
      const back = new URL(options.redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", params.get("state")!);
      response.writeHead(302, { location: back.toString() }).end();
      return;
    }

    if (request.method === "POST" && url.pathname === "/oauth/token") {
      const form = new URLSearchParams(await readBody(request));
      const granted = pending;
      if (
        !isClient(request.headers.authorization, options) ||
        form.get("grant_type") !== "authorization_code" ||
        form.get("code") !== code ||
        form.get("redirect_uri") !== options.redirectUri ||
        !granted ||
        createHash("sha256")
          .update(form.get("code_verifier") ?? "")
          .digest("base64url") !== granted.challenge
      ) {
        json(400, JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      pending = null; // A code works once.
      json(
        200,
        JSON.stringify({
          access_token: randomBytes(16).toString("base64url"),
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken(granted.nonce),
        }),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/oauth/jwks") {
      json(200, jwks);
      return;
    }

    response.writeHead(404).end();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () =>
      resolve({
        close: () => new Promise<void>((done) => server.close(() => done())),
      }),
    );
  });
}

// client_secret_basic: Basic base64(urlencode(id):urlencode(secret)).
function isClient(header: string | undefined, options: FfpfStubOptions) {
  const expected = Buffer.from(
    `Basic ${Buffer.from(
      `${encodeURIComponent(options.clientId)}:${encodeURIComponent(options.clientSecret)}`,
    ).toString("base64")}`,
  );
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
