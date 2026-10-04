type LineConfig = {
  secret: string;
  accessToken: string;
  userId: string;
  botId: string;
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
  return { secret, accessToken, userId, botId };
}
