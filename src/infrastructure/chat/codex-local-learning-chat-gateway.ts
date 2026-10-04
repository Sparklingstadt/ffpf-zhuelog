import type {
  LearningChatGateway,
  LearningChatRequest,
} from "@ffpf-zhuelog/core/application/chat/ports/learning-chat-gateway";
import {
  LearningChatBusyError,
  LearningChatError,
} from "@ffpf-zhuelog/core/domain/chat/learning-chat-error";
import { CodexLocalError, runCodexLocalTurn } from "./codex-local-client";

// Limit usage to one active local generation, including across dev hot reloads.
const state = globalThis as typeof globalThis & { zhuelogCodexBusy?: boolean };

export class CodexLocalLearningChatGateway implements LearningChatGateway {
  stream(request: LearningChatRequest): AsyncIterable<string> {
    if (state.zhuelogCodexBusy)
      throw new LearningChatBusyError(
        "別の会話が応答中です。完了または停止してから送信してください。",
      );
    state.zhuelogCodexBusy = true;
    let open = true;
    // The turn starts now and frees the slot when it ends, whether or not
    // anyone reads the stream. Cancellation arrives through request.signal.
    return new ReadableStream<string>({
      start(controller) {
        runCodexLocalTurn({
          instructions: request.systemPrompt,
          text: JSON.stringify(request.messages),
          signal: request.signal,
          onDelta: (delta) => {
            if (open) controller.enqueue(delta);
          },
        })
          .then(
            () => {
              if (open) controller.close();
            },
            (error) =>
              controller.error(
                new LearningChatError(
                  error instanceof CodexLocalError
                    ? error.message
                    : "Codexの応答を取得できませんでした。",
                ),
              ),
          )
          .finally(() => {
            open = false;
            state.zhuelogCodexBusy = false;
          });
      },
      cancel() {
        open = false;
      },
    });
  }
}
