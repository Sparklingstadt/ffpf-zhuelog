import type { AuthenticatedUser } from "../../domain/identity/entities/authenticated-user";
import { LINK_CODE_TTL_MS } from "../../domain/line/link-code";

// The signed-in user may not link LINE: signed out, a guest, revoked,
// without an owner id, the demo account, or an admin acting as a member (Go:
// the link routes' notForDemo and IssueCode's role check).
export class LineLinkForbiddenError extends Error {
  override name = "LineLinkForbiddenError";
}

export type LineLinkDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  // LINE is configured (Go registered the link routes only then).
  enabled: boolean;
  store: {
    status(
      ownerId: string,
    ): Promise<{ linked: boolean; reviewNotify: boolean }>;
    // false: no LINE account is linked.
    setReviewNotify(ownerId: string, on: boolean): Promise<boolean>;
    unlinkOwner(ownerId: string): Promise<void>;
    putCode(
      ownerId: string,
      role: "member" | "admin",
      codeHash: string,
      expiresAt: Date,
    ): Promise<void>;
  };
  newCode: () => string;
  hashCode: (code: string) => string;
  now: () => Date;
};

// The /account/line page: the signed-in member's or admin's own LINE link
// (Go: the link routes, services/api/httpapi/line_handlers.go:106-163). The
// user is decided first, so a refused user is refused even when LINE is off.
export function createLineLink(deps: LineLinkDeps) {
  async function owner(): Promise<{
    ownerId: string;
    role: "member" | "admin";
  }> {
    const user = await deps.currentUser();
    if (
      !user ||
      (user.role !== "member" && user.role !== "admin") ||
      user.actingAs ||
      user.demo === true ||
      !user.githubId
    )
      throw new LineLinkForbiddenError();
    return { ownerId: user.githubId, role: user.role };
  }

  return {
    // available false: LINE is not configured here (Go's 404); the database
    // is not read. The LINE user id never leaves the store.
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

    // Go: IssueCode. Replaces the owner's previous code; only the code's hash
    // is stored.
    async issueCode(): Promise<{ code: string; expiresAt: Date }> {
      const { ownerId, role } = await owner();
      if (!deps.enabled) throw new Error("LINE_UNAVAILABLE");
      const code = deps.newCode();
      const expiresAt = new Date(deps.now().getTime() + LINK_CODE_TTL_MS);
      await deps.store.putCode(ownerId, role, deps.hashCode(code), expiresAt);
      return { code, expiresAt };
    },

    // Go: Unlink. Nothing linked is not an error.
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
