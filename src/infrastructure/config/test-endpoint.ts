const LOOPBACK_ENDPOINT =
  /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?\/?$/;

// Lets end-to-end tests point a provider at a local fake. Anything other than
// a loopback origin is refused so a stray variable can never redirect traffic
// (or credentials) to another host.
export function endpointOverride(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  if (!LOOPBACK_ENDPOINT.test(trimmed))
    throw new Error("INVALID_TEST_ENDPOINT");
  return trimmed.replace(/\/$/, "");
}
