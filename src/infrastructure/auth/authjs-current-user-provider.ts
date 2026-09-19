import type { CurrentUserProvider } from "@/application/identity/ports/current-user-provider";
import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { auth } from "@/infrastructure/auth/authjs-config";

export class AuthJsCurrentUserProvider implements CurrentUserProvider {
  async getCurrentUser(): Promise<AuthenticatedUser | null> {
    const session = await auth();
    if (!session?.user) return null;
    return {
      githubLogin: session.user.githubLogin,
      role: session.user.role,
    };
  }
}
