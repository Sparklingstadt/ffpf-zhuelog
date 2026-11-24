import { bearerMatches } from "@/infrastructure/security/bearer-secret";
import { errorName } from "./load-or";

const noStore = { "Cache-Control": "no-store" };

// A Vercel Cron call: the secret, then the job; 204 when it worked. A
// missing or empty secret refuses every call. A failure is logged by its
// fixed code and the error's name only.
export async function handleCronRequest(
  request: Request,
  deps: {
    secret: string | undefined;
    run: () => Promise<void>;
    failureCode: string;
  },
): Promise<Response> {
  if (!bearerMatches(request.headers.get("authorization"), deps.secret))
    return Response.json(
      { error: { code: "unauthorized", message: "認証が必要です。" } },
      { status: 401, headers: noStore },
    );
  try {
    await deps.run();
  } catch (error) {
    console.error(deps.failureCode, errorName(error));
    return Response.json(
      {
        error: {
          code: "internal",
          message: "サーバーでエラーが発生しました。",
        },
      },
      { status: 500, headers: noStore },
    );
  }
  return new Response(null, { status: 204, headers: noStore });
}
