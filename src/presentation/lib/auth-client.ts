// The browser's Better Auth client. Sign-in by members, Sparklingstadt ID and
// guests goes through it to /api/auth/* (same origin), so Better Auth's rate
// limit counts every attempt; server-side auth.api calls would not be counted.
//
// better-auth 1.7 has no genericOAuth client plugin: its providers ("sid")
// sign in through the core signIn.social.

import { createAuthClient } from "better-auth/react";
import {
  adminClient,
  anonymousClient,
  usernameClient,
} from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [usernameClient(), anonymousClient(), adminClient()],
});
