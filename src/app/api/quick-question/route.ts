import { questionNotes } from "@/composition/question-container";
import { handleQuickQuestion } from "@/presentation/controllers/quick-question-controller";

export const dynamic = "force-dynamic";
// OpenAI's answer is cut at 60 seconds; 90 is Go's chatWriteTimeout.
export const maxDuration = 90;

export async function POST(request: Request) {
  return handleQuickQuestion(request, { asker: () => questionNotes.asker() });
}
