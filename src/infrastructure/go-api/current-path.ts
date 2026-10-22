import { getSafeCallbackPath } from "@/presentation/http/safe-callback-path";

// The proxy puts the page's path and query here, so Server Components and
// Server Actions know where to come back to after signing in. The proxy
// always overwrites it, so a value sent by the browser never gets through.
export const CURRENT_PATH_HEADER = "x-zhuelog-path";

// The same /signin?callbackUrl=… the proxy builds, made safe against open
// redirects. Without a known path it is plain /signin.
export function signInPathFor(currentPath: string | null | undefined): string {
  if (!currentPath) return "/signin";
  const callbackPath = getSafeCallbackPath(currentPath);
  return `/signin?callbackUrl=${encodeURIComponent(callbackPath)}`;
}
