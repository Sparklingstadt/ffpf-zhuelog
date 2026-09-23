import {
  correctionSchema,
  LINE_CORRECTION_INSTRUCTIONS,
} from "@/domain/line/line-learning";
import { runCodexLocalTurn } from "@/infrastructure/chat/codex-local-client";

export async function correctLineText(text: string, signal?: AbortSignal) {
  let output = "";
  await runCodexLocalTurn({
    instructions: LINE_CORRECTION_INSTRUCTIONS,
    text: JSON.stringify({ originalText: text }),
    signal,
    onDelta: (delta) => {
      output += delta;
    },
  });
  return correctionSchema.parse(JSON.parse(output));
}
