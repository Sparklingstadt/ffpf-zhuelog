// Attempt limits counted in the SignInThrottle table, with Go's keys and
// numbers (services/api/auth/service.go, services/api/httpapi/router.go), so
// the web and Go's sign-in share the same counts until sign-in moves too.

export type ThrottleRule = { limit: number; windowMs: number };

// Go: maxFailuresPerLogin (5) per throttleWindow (15 minutes), counted on
// "password-change:<accountId>". Reset on success; never blocks sign-in.
export const PASSWORD_CHANGE_THROTTLE: ThrottleRule = {
  limit: 5,
  windowMs: 15 * 60 * 1000,
};

// Go: authRateLimit (10) per authRateWindow (1 minute), counted on
// "route:auth:<client>" — the same key as Go's /v1/auth/* routes.
export const AUTH_ROUTE_THROTTLE: ThrottleRule = {
  limit: 10,
  windowMs: 60 * 1000,
};

export function passwordChangeThrottleKey(accountId: string): string {
  return `password-change:${accountId}`;
}

export function authRouteThrottleKey(client: string): string {
  return `route:auth:${client}`;
}
