type LineConfig = {
  secret: string;
  accessToken: string;
  userId: string;
  botId: string;
  workerToken: string;
  developmentEnabled?: boolean;
};
export function getLineConfig(): LineConfig | null {
  const secret = process.env.LINE_CHANNEL_SECRET?.trim();
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const userId = process.env.LINE_ALLOWED_USER_ID?.trim();
  const botId = process.env.LINE_BOT_USER_ID?.trim();
  const workerToken = process.env.LINE_WORKER_TOKEN?.trim();
  if (
    process.env.LINE_INTEGRATION_ENABLED !== "true" ||
    !secret ||
    !accessToken ||
    !userId ||
    !/^U[0-9a-f]{32}$/i.test(userId) ||
    !botId ||
    !/^U[0-9a-f]{32}$/i.test(botId) ||
    !workerToken ||
    !/^[0-9a-f]{64}$/i.test(workerToken)
  )
    return null;
  return {
    secret,
    accessToken,
    userId,
    botId,
    workerToken,
    developmentEnabled: process.env.LINE_DEV_MODE_ENABLED === "true",
  };
}
