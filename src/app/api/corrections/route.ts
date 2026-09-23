import { getCurrentViewerUser } from "@/composition/identity-container";
import { correctPersonalText } from "@/composition/practice-container";
import { handlePersonalCorrection } from "@/presentation/controllers/personal-correction-controller";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handlePersonalCorrection(request, {
    isAuthenticated: async () => Boolean(await getCurrentViewerUser()),
    correctText: correctPersonalText,
  });
}
