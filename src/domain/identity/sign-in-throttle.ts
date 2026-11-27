// Attempt limits counted in the SignInThrottle table: each rule's limit and
// window, and the key its attempts are counted on. Sign-in itself is limited
// by Better Auth's rate limit (infrastructure/auth/better-auth-rules); these
// remain for the own password change and the LINE link codes.

export type ThrottleRule = { limit: number; windowMs: number };

// 5 failures per 15 minutes, counted on "password-change:<accountId>". Reset
// on success; never blocks sign-in.
export const PASSWORD_CHANGE_THROTTLE: ThrottleRule = {
  limit: 5,
  windowMs: 15 * 60 * 1000,
};

// 10 requests per minute for the password change, counted on
// "route:auth:<client>".
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
