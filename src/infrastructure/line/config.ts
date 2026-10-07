import { isOwnerId } from "@ffpf-zhuelog/core/domain/identity/owner-id";

type LineConfig = {
  secret: string;
  accessToken: string;
  userId: string;
  botId: string;
  // Owner of the notes LINE saves. Null when LINE_NOTE_OWNER_ID is missing or
  // malformed: LINE stays enabled and each job gets a failure reply.
  noteOwnerId: string | null;
};
export function getLineConfig(): LineConfig | null {
  const secret = process.env.LINE_CHANNEL_SECRET?.trim();
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const userId = process.env.LINE_ALLOWED_USER_ID?.trim();
  const botId = process.env.LINE_BOT_USER_ID?.trim();
  if (
    process.env.LINE_INTEGRATION_ENABLED !== "true" ||
    !secret ||
    !accessToken ||
    !userId ||
    !/^U[0-9a-f]{32}$/i.test(userId) ||
    !botId ||
    !/^U[0-9a-f]{32}$/i.test(botId)
  )
    return null;
  const owner = process.env.LINE_NOTE_OWNER_ID?.trim();
  const noteOwnerId = owner && isOwnerId(owner) ? owner : null;
  return { secret, accessToken, userId, botId, noteOwnerId };
}
