import type { NextRequest } from "next/server";

import { handleSidCallback } from "@/presentation/http/sid-callback";

// The Sparklingstadt ID server sends the browser back here (sidRedirectUri) after
// sign-in.
export function GET(request: NextRequest) {
  return handleSidCallback(request);
}
