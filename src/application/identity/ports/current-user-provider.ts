import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";

export interface CurrentUserProvider {
  getCurrentUser(): Promise<AuthenticatedUser | null>;
}
