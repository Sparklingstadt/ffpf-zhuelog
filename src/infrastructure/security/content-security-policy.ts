export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
  https: boolean,
  // Forms whose submission redirects there: the sign-out's redirect to the
  // Sparklingstadt ID issuer's logout (when JavaScript has not loaded).
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
    ["form-action 'self'", ...formActionOrigins].join(" "),
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
