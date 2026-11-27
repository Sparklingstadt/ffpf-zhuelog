import type { AuthenticatedUser } from "../../domain/identity/entities/authenticated-user";
import { LINK_CODE_TTL_MS } from "../../domain/line/link-code";

// The signed-in user may not link LINE: signed out, a guest, the demo
// account, or an admin impersonating a member (so the admin's LINE is never
// tied to the member).
export class LineLinkForbiddenError extends Error {
  override name = "LineLinkForbiddenError";
}

export type LineLinkDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  // LINE is configured.
  enabled: boolean;
  store: {
    status(
      ownerId: string,
    ): Promise<{ linked: boolean; reviewNotify: boolean }>;
    // false: no LINE account is linked.
    setReviewNotify(ownerId: string, on: boolean): Promise<boolean>;
    unlinkOwner(ownerId: string): Promise<void>;
    putCode(ownerId: string, codeHash: string, expiresAt: Date): Promise<void>;
  };
  newCode: () => string;
  hashCode: (code: string) => string;
  now: () => Date;
};

// The /account/line page: the signed-in member's or admin's own LINE link.
// The user is decided first, so a refused user is refused even when LINE is
// off.
export function createLineLink(deps: LineLinkDeps) {
  async function owner(): Promise<{ ownerId: string }> {
    const user = await deps.currentUser();
    if (
      !user ||
      (user.role !== "member" && user.role !== "admin") ||
      user.impersonatedBy !== undefined ||
      user.demo === true
    )
      throw new LineLinkForbiddenError();
    return { ownerId: user.userId };
  }

  return {
    // available false: LINE is not configured here; the database is not
    // read. The LINE user id never leaves the store.
    async status(): Promise<{
      available: boolean;
      linked: boolean;
      reviewNotify: boolean;
    }> {
      const { ownerId } = await owner();
      if (!deps.enabled)
        return { available: false, linked: false, reviewNotify: false };
      return { available: true, ...(await deps.store.status(ownerId)) };
    },

    // Replaces the owner's previous code; only the code's hash is stored.
    async issueCode(): Promise<{ code: string; expiresAt: Date }> {
      const { ownerId } = await owner();
      if (!deps.enabled) throw new Error("LINE_UNAVAILABLE");
      const code = deps.newCode();
      const expiresAt = new Date(deps.now().getTime() + LINK_CODE_TTL_MS);
      await deps.store.putCode(ownerId, deps.hashCode(code), expiresAt);
      return { code, expiresAt };
    },

    // Nothing linked is not an error.
    async unlink(): Promise<void> {
      const { ownerId } = await owner();
      if (!deps.enabled) return;
      await deps.store.unlinkOwner(ownerId);
    },

    // The morning review message on or off. false: LINE is not linked (or
    // not available here).
    async setReviewNotify(on: boolean): Promise<boolean> {
      const { ownerId } = await owner();
      if (!deps.enabled) return false;
      return deps.store.setReviewNotify(ownerId, on);
    },
  };
}
