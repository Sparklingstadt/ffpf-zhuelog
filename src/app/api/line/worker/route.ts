import { createLineContainer } from "@/composition/line-container";
import { handleLineWorker } from "@/presentation/controllers/line-worker-controller";

export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  const { config, jobs, service } = createLineContainer();
  return handleLineWorker(request, config, jobs, service);
}
