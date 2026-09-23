import { chatUseCases } from "@/composition/chat-container";
import { getCurrentViewerUser } from "@/composition/identity-container";
import { isOpenAiConfigured } from "@/infrastructure/config/environment";
import { handleChatRequest } from "@/presentation/controllers/chat-controller";
import {
  isCodexLocalRequested,
  isLocalChatRequest,
} from "@/infrastructure/chat/codex-local-policy";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getCurrentViewerUser();
  if (!user) {
    return Response.json({ error: "認証が必要です。" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return Response.json(
      { error: "ゲストはChatGPTを利用できません。" },
      { status: 403 },
    );
  }

  if (isCodexLocalRequested() && !isLocalChatRequest(request)) {
    return Response.json(
      {
        error: "この接続はローカル開発環境の同一オリジンからのみ利用できます。",
      },
      { status: 403 },
    );
  }

  if (!isCodexLocalRequested() && !isOpenAiConfigured()) {
    return Response.json(
      { error: "OPENAI_API_KEYが設定されていません。" },
      { status: 503 },
    );
  }

  return handleChatRequest(request, chatUseCases.streamLearningChat);
}
