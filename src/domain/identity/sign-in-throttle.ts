// An attempt limit counted in the SignInThrottle table: at most `limit`
// attempts per window of `windowMs`. Only the LINE link-code redemption
// counts there now (domain/line/link-code); sign-in and the own password
// change are limited by Better Auth's rate limit
// (infrastructure/auth/better-auth-rules).

export type ThrottleRule = { limit: number; windowMs: number };
