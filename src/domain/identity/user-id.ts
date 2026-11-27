// A Better Auth user id: what owns records and what `?user=` and the follow
// forms name. Better Auth makes 32 letters and digits; anything outside this
// shape (path segments, the retired "password:"/"sid:" owner ids) is never
// trusted.
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isUserId(value: string): boolean {
  return USER_ID.test(value);
}
