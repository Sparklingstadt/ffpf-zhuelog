import { authHandler } from "@/infrastructure/auth/better-auth";

// Better Auth's endpoints (sign-in, sign-out, sessions, the admin plugin, the
// Sparklingstadt ID callback at /api/auth/callback/sid).
export const { GET, POST } = authHandler;
