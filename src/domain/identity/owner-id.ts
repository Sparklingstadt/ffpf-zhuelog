// A record owner is a numeric GitHub account id, "password:<id>" for a
// password account, or "ffpf:<sub>" for an FFPF ID account. The password id is
// a Prisma cuid and the FFPF ID sub is lowercase alphanumeric; anything else
// (e.g. path segments) is never trusted.
const GITHUB_OWNER_ID = /^\d+$/;
const PASSWORD_OWNER_ID = /^password:[a-z0-9]{20,32}$/;
const FFPF_OWNER_ID = /^ffpf:[a-z0-9]{1,64}$/;

// FFPF ID members change their password in the portal, not here.
export const FFPF_OWNER_PREFIX = "ffpf:";

export function isOwnerId(value: string): boolean {
  return (
    GITHUB_OWNER_ID.test(value) ||
    PASSWORD_OWNER_ID.test(value) ||
    FFPF_OWNER_ID.test(value)
  );
}
