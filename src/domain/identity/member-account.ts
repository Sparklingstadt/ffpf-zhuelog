// A password account as an administrator sees it: never the hash.
export type MemberAccount = {
  id: string;
  ownerId: string;
  loginId: string;
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
