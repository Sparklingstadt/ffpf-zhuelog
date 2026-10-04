import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import { LearningChatError } from "@ffpf-zhuelog/core/domain/chat/learning-chat-error";

// Render answer text as the AI SDK UI message stream that useChat reads.
// `onCancel` runs when the reader goes away, so the provider can stop too.
export function learningChatResponse(
  answer: AsyncIterable<string>,
  onCancel: () => void,
) {
  const stream = createUIMessageStream({
    async execute({ writer }) {
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: "answer" });
      for await (const delta of answer)
        writer.write({ type: "text-delta", id: "answer", delta });
      writer.write({ type: "text-end", id: "answer" });
      writer.write({ type: "finish", finishReason: "stop" });
      writer.setOutcome({ status: "completed" });
    },
    // Never show provider errors, which may contain request details.
    onError: (error) =>
      error instanceof LearningChatError
        ? error.message
        : "応答を取得できませんでした。",
  });
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
        onCancel();
        await reader.cancel();
      },
    }),
  });
}
