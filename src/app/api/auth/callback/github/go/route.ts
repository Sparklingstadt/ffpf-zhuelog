import type { NextRequest } from "next/server";

import { handleGitHubCallback } from "@/presentation/http/github-callback";

// GitHub sends the browser back here (githubRedirectUri) after sign-in.
export function GET(request: NextRequest) {
  return handleGitHubCallback(request);
}
