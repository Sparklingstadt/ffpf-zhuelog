import { demoReset } from "@/composition/demo-container";
import { cronSecret } from "@/infrastructure/config/environment";
import { handleCronRequest } from "@/presentation/controllers/cron-controller";

export const dynamic = "force-dynamic";
// The reset's transaction gives up at 25 s (DEMO_RESET_TRANSACTION_OPTIONS).
export const maxDuration = 30;

// The nightly demo reset (Go: GET and POST /v1/cron/demo-reset,
// httpapi/demo.go): the demo account back to its fixture. Not registered as
// a Vercel Cron yet.
async function resetDemo(request: Request): Promise<Response> {
  // Without DEMO_LOGIN_ID the route does not exist, before the secret (as Go).
  if (!demoReset.available)
    return Response.json(
      { error: { code: "not_found", message: "見つかりません。" } },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  return handleCronRequest(request, {
    secret: cronSecret(),
    run: async () => {
      await demoReset.reset();
      console.info("DEMO_RESET_DONE");
    },
    failureCode: "DEMO_RESET_FAILED",
  });
}

export async function GET(request: Request): Promise<Response> {
  return resetDemo(request);
}

export async function POST(request: Request): Promise<Response> {
  return resetDemo(request);
}
