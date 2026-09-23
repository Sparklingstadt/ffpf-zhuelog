import type { CurrentUserProvider } from "@/application/identity/ports/current-user-provider";

export class RequireViewerUser {
  constructor(private readonly currentUserProvider: CurrentUserProvider) {}

  async execute() {
    const user = await this.currentUserProvider.getCurrentUser();
    return user?.role === "admin" || user?.role === "guest" ? user : null;
  }
}
