// A member as an administrator sees it on /admin/accounts. id is the member's
// user id (the owner of their records). loginId is null for a member who
// signs in with Sparklingstadt ID: they have no password here.
export type MemberAccount = {
  id: string;
  loginId: string | null;
  displayName: string;
  createdAt: Date;
};

// The password to hand to the member once: the one the admin typed, or a
// generated one when the field was left blank.
export type IssuedPassword = {
  loginId: string;
  password: string;
  generated: boolean;
};
