export function normalizeLineOfficialAccountId(
  value?: string,
): string | undefined {
  const id = value?.trim();
  return id && /^@[A-Za-z0-9._-]{1,100}$/.test(id) ? id : undefined;
}

export function lineLinkMessageUrl(
  accountId: string,
  code: string,
): string | undefined {
  const id = normalizeLineOfficialAccountId(accountId);
  if (!id || !/^[A-Z2-9]{8}$/.test(code)) return undefined;
  return `https://line.me/R/oaMessage/${encodeURIComponent(id)}/?${encodeURIComponent(code)}`;
}
