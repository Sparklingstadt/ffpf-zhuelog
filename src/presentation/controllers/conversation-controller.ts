import { z } from "zod";
import {
  isMemberRole,
  type AuthenticatedUser,
} from "@ffpf-zhuelog/core/domain/identity/entities/authenticated-user";
import { ConversationOwnershipError } from "@ffpf-zhuelog/core/domain/chat/conversation";
import type { ConversationRepository } from "@ffpf-zhuelog/core/domain/chat/repositories/conversation-repository";
import { SaveConversation } from "@ffpf-zhuelog/core/application/chat/use-cases/save-conversation";
import {
  readLimitedBody,
  BodyLimitError,
} from "@/infrastructure/http/read-limited-body";
import { isSameOriginRequest } from "../http/same-origin";
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function denial(user: AuthenticatedUser | null) {
  if (!user) return json({ error: "認証が必要です。" }, 401);
  if (!isMemberRole(user.role))
    return json({ error: "ゲストは利用できません。" }, 403);
  if (!user.githubId)
    return json({ error: "一度ログアウトしてログインし直してください。" }, 401);
  return null;
}
export async function handleConversationSave(
  request: Request,
  user: AuthenticatedUser | null,
  repository: ConversationRepository,
) {
  const denied = denial(user);
  if (denied) return denied;
  if (!isSameOriginRequest(request))
    return json({ error: "この画面から保存してください。" }, 403);
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    return json({ error: "JSON形式で送信してください。" }, 415);
  try {
    const input = JSON.parse(
      (await readLimitedBody(request, 256 * 1024)).toString("utf8"),
    );
    return json(
      await new SaveConversation(repository).execute(user!.githubId!, input),
    );
  } catch (error) {
    if (error instanceof BodyLimitError)
      return json({ error: "会話が大きすぎます。" }, 413);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return json({ error: "会話の形式または上限を確認してください。" }, 400);
    if (error instanceof ConversationOwnershipError)
      return json({ error: "この会話にはアクセスできません。" }, 403);
    return json(
      {
        error:
          "DBへ保存できませんでした。端末のバックアップまたはダウンロードを利用できます。",
      },
      503,
    );
  }
}
export async function handleConversationRead(
  user: AuthenticatedUser | null,
  repository: ConversationRepository,
  id?: string,
) {
  const denied = denial(user);
  if (denied) return denied;
  if (id && !z.uuid().safeParse(id).success)
    return json({ error: "会話IDが不正です。" }, 400);
  try {
    if (!id) return json(await repository.list(user!.githubId!));
    const value = await repository.get(user!.githubId!, id);
    return value ? json(value) : json({ error: "会話が見つかりません。" }, 404);
  } catch {
    return json({ error: "保存履歴を取得できませんでした。" }, 503);
  }
}
