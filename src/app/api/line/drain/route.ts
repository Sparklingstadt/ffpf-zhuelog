import { createLineContainer } from "@/composition/line-container";
import { handleLineDrain } from "@/presentation/controllers/line-drain-controller";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const { createDrain } = createLineContainer();
  return handleLineDrain(request, process.env.CRON_SECRET, createDrain);
}
