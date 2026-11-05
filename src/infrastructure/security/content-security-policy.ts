export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
  https: boolean,
  // Sign-in forms redirect there (e.g. the FFPF ID issuer's origin).
  formActionOrigins: string[] = [],
) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    ["form-action 'self' https://github.com", ...formActionOrigins].join(" "),
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
