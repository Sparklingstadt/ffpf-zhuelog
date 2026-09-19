export function isAuthConfigured() {
  return Boolean(
    process.env.AUTH_SECRET &&
      process.env.AUTH_GITHUB_ID &&
      process.env.AUTH_GITHUB_SECRET &&
      process.env.AUTH_ALLOWED_GITHUB_LOGINS,
  );
}

export function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getOpenAiModelName() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
}
