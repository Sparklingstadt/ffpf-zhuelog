// The demo account's password hash: not a scrypt hash, so no password ever
// signs in to it (Go: store.DemoPasswordHash). People enter the demo with the
// demo sign-in instead; the nightly reset writes it on the account it makes.
export const DEMO_PASSWORD_HASH = "demo:no-password";
