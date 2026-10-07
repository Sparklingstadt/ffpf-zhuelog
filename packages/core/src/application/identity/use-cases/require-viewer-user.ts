import { isMemberRole } from "../../../domain/identity/entities/authenticated-user";
import type { CurrentUserProvider } from "../ports/current-user-provider";

export class RequireViewerUser {
  constructor(private readonly currentUserProvider: CurrentUserProvider) {}

  async execute() {
    const user = await this.currentUserProvider.getCurrentUser();
    return user && (isMemberRole(user.role) || user.role === "guest")
      ? user
      : null;
  }
}
