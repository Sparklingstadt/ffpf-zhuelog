// Attempt limits counted in the SignInThrottle table: each rule's limit and
// window, and the key its attempts are counted on.

export type ThrottleRule = { limit: number; windowMs: number };

// 5 failures per 15 minutes, counted on "password-change:<accountId>". Reset
// on success; never blocks sign-in.
export const PASSWORD_CHANGE_THROTTLE: ThrottleRule = {
  limit: 5,
  windowMs: 15 * 60 * 1000,
};

// 10 requests per minute across every kind of sign-in and the password
// change, counted on "route:auth:<client>".
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

// 20 attempts per 15 minutes, counted on "client:<client>" before the input
// of a password sign-in is read.
export const SIGN_IN_CLIENT_THROTTLE: ThrottleRule = {
  limit: 20,
  windowMs: 15 * 60 * 1000,
};

// 5 failures per 15 minutes, counted on "login:<client>:<loginId>"; reset on
// a successful sign-in.
export const SIGN_IN_LOGIN_THROTTLE: ThrottleRule = {
  limit: 5,
  windowMs: 15 * 60 * 1000,
};

// 20 demo sign-ins per 15 minutes, counted on "demo:<client>".
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
