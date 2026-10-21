import type { NextRequest } from "next/server";

import { handleGitHubCallback } from "@/presentation/http/github-callback";

// A static path, so it wins over the Auth.js catch-all /api/auth/[...nextauth].
export function GET(request: NextRequest) {
  return handleGitHubCallback(request);
}
