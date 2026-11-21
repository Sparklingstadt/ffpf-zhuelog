// A record owner is a numeric GitHub account id, "password:<id>" for a
// password account, or "sid:<sub>" for a Sparklingstadt ID account. The password id is
// a Prisma cuid and the Sparklingstadt ID sub is lowercase alphanumeric; anything else
// (e.g. path segments) is never trusted.
const GITHUB_OWNER_ID = /^\d+$/;
const PASSWORD_OWNER_ID = /^password:[a-z0-9]{20,32}$/;
const SID_OWNER_ID = /^sid:[a-z0-9]{1,64}$/;

// Sparklingstadt ID members change their password on the Sparklingstadt ID server, not here.
export const SID_OWNER_PREFIX = "sid:";

export function isOwnerId(value: string): boolean {
  return (
    GITHUB_OWNER_ID.test(value) ||
    PASSWORD_OWNER_ID.test(value) ||
    SID_OWNER_ID.test(value)
  );
}
