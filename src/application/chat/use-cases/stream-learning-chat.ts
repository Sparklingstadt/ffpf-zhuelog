import type { LearningChatGateway } from "@/application/chat/ports/learning-chat-gateway";
import type { LearningChatMessage } from "@/domain/chat/entities/chat-message";

const SYSTEM_PROMPT = `あなたは中国語学習アプリ「学习録」の会話パートナーです。
ユーザーの中国語学習を支援してください。
- 原則として、ユーザーが使った言語に合わせて答える。
- 中国語の例文には、必要に応じてピン音と自然な日本語訳を添える。
- 間違いを直すときは、自然な修正文と短い理由を示す。
- 会話練習では細かい訂正で流れを止めすぎず、会話を続けてから要点を整理する。
- 確信がない内容を断定しない。
- 回答は学習しやすい長さにまとめる。`;

export class StreamLearningChat {
  constructor(private readonly gateway: LearningChatGateway) {}

  execute(messages: LearningChatMessage[], signal?: AbortSignal) {
    return this.gateway.stream({
      signal,
      messages,
      systemPrompt: SYSTEM_PROMPT,
      maxOutputTokens: 1_600,
    });
  }
}
