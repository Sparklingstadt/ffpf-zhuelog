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

// Go: maxAttemptsPerClient (20) per throttleWindow (15 minutes), counted on
// "client:<client>" before anything else in a password sign-in.
export const SIGN_IN_CLIENT_THROTTLE: ThrottleRule = {
  limit: 20,
  windowMs: 15 * 60 * 1000,
};

// Go: maxFailuresPerLogin (5) per 15 minutes, counted on
// "login:<client>:<loginId>"; reset on a successful sign-in.
export const SIGN_IN_LOGIN_THROTTLE: ThrottleRule = {
  limit: 5,
  windowMs: 15 * 60 * 1000,
};

// Go: LoginDemo's limit (maxAttemptsPerClient, 20 per 15 minutes), counted on
// "demo:<client>".
export const DEMO_SIGN_IN_THROTTLE: ThrottleRule = {
  limit: 20,
  windowMs: 15 * 60 * 1000,
};

export function signInClientThrottleKey(client: string): string {
  return `client:${client}`;
}

export function signInLoginThrottleKey(
  client: string,
  loginId: string,
): string {
  return `login:${client}:${loginId}`;
}

export function demoSignInThrottleKey(client: string): string {
  return `demo:${client}`;
}
