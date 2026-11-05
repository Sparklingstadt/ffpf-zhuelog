import type { NextRequest } from "next/server";

import { handleFfpfCallback } from "@/presentation/http/ffpf-callback";

// The FFPF ID portal sends the browser back here (ffpfRedirectUri) after
// sign-in.
export function GET(request: NextRequest) {
  return handleFfpfCallback(request);
}
