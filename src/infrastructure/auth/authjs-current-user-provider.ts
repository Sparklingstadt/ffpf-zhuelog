import type { CurrentUserProvider } from "@ffpf-zhuelog/core/application/identity/ports/current-user-provider";
import type { AuthenticatedUser } from "@ffpf-zhuelog/core/domain/identity/entities/authenticated-user";
import { auth } from "@/infrastructure/auth/authjs-config";
import { isCurrentMemberSession } from "./member-session-policy";

export class AuthJsCurrentUserProvider implements CurrentUserProvider {
  constructor(
    private readonly findById: (
      id: string,
    ) => Promise<{ sessionVersion: number } | null>,
  ) {}

  async getCurrentUser(): Promise<AuthenticatedUser | null> {
    const session = await auth();
    if (!session?.user) return null;
    const user: AuthenticatedUser = {
      githubLogin: session.user.githubLogin,
      githubId: session.user.githubId,
      role: session.user.role,
    };
    if (user.role !== "member") return user;

    const member: AuthenticatedUser = {
      ...user,
      displayName: session.user.name ?? undefined,
      accountId: session.user.accountId,
    };
    // A password change or reset bumps sessionVersion; older JWTs are revoked.
    return (await isCurrentMemberSession(session.user, this.findById))
      ? member
      : { ...member, role: "revoked" };
  }
}
