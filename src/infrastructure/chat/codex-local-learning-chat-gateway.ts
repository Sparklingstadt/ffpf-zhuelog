import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import type {
  LearningChatGateway,
  LearningChatRequest,
} from "@/application/chat/ports/learning-chat-gateway";
import { CodexLocalError, runCodexLocalTurn } from "./codex-local-client";

// Limit usage to one active local generation, including across dev hot reloads.
const state = globalThis as typeof globalThis & { zhuelogCodexBusy?: boolean };

export class CodexLocalLearningChatGateway implements LearningChatGateway {
  stream(request: LearningChatRequest): Response {
    if (state.zhuelogCodexBusy) {
      return Response.json(
        {
          error:
            "別の会話が応答中です。完了または停止してから送信してください。",
        },
        { status: 429 },
      );
    }
    state.zhuelogCodexBusy = true;
    const abort = new AbortController();
    const signal = request.signal
      ? AbortSignal.any([request.signal, abort.signal])
      : abort.signal;
    const stream = createUIMessageStream({
      async execute({ writer }) {
        try {
          writer.write({ type: "start" });
          writer.write({ type: "text-start", id: "answer" });
          await runCodexLocalTurn({
            instructions: request.systemPrompt,
            text: JSON.stringify(request.messages),
            signal,
            onDelta: (delta) =>
              writer.write({ type: "text-delta", id: "answer", delta }),
          });
          writer.write({ type: "text-end", id: "answer" });
          writer.write({ type: "finish", finishReason: "stop" });
          writer.setOutcome({ status: "completed" });
        } finally {
          state.zhuelogCodexBusy = false;
        }
      },
      onError: (error) =>
        error instanceof CodexLocalError
          ? error.message
          : "Codexの応答を取得できませんでした。",
    });
    // Forward downstream cancellation to the process as well as Request.signal.
    const reader = stream.getReader();
    return createUIMessageStreamResponse({
      headers: { "Cache-Control": "no-store" },
      stream: new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        },
        async cancel() {
          abort.abort();
          await reader.cancel();
        },
      }),
    });
  }
}
