import { createLineContainer } from "@/composition/line-container";
import { handleLineWebhook } from "@/presentation/controllers/line-webhook-controller";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const { config, jobs } = createLineContainer();
  return handleLineWebhook(request, config, jobs);
}
