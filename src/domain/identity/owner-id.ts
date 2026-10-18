// A record owner is a numeric GitHub account id, or "password:<id>" for a
// password account. The id is a Prisma cuid; anything else (e.g. path
// segments) is never trusted.
const GITHUB_OWNER_ID = /^\d+$/;
const PASSWORD_OWNER_ID = /^password:[a-z0-9]{20,32}$/;

export function isOwnerId(value: string): boolean {
  return GITHUB_OWNER_ID.test(value) || PASSWORD_OWNER_ID.test(value);
}
