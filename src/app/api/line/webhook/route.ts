import { after } from "next/server";
import { createLineContainer } from "@/composition/line-container";
import { LINE_DRAIN_BUDGET_MS } from "@/presentation/controllers/line-drain-controller";
import { handleLineWebhook } from "@/presentation/controllers/line-webhook-controller";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const { config, jobs, drain } = createLineContainer();
  const response = await handleLineWebhook(request, config, jobs);
  if (response.status === 200 && drain) {
    const deadline = Date.now() + LINE_DRAIN_BUDGET_MS;
    after(async () => {
      try {
        await drain.execute(deadline);
      } catch {
        // Fixed code only: errors from the database may contain row data.
        console.error("LINE_DRAIN_FAILED");
      }
    });
  }
  return response;
}
