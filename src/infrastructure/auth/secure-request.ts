// HTTPS behind Vercel's proxy shows up as x-forwarded-proto; AUTH_URL covers
// deployments that state their public origin.
export function isSecureRequest(requestHeaders: Headers): boolean {
  const proto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return (
    proto === "https" || Boolean(process.env.AUTH_URL?.startsWith("https:"))
  );
}
