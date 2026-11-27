import { UserRoundCog } from "lucide-react";

import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { stopActingAction } from "@/presentation/actions/acting-actions";
import { Button } from "@/presentation/components/ui/button";

// Shown on every page while an admin impersonates a member (Better Auth's
// session.impersonatedBy), so the admin always knows whose records they are
// changing and can get back in one click: the button ends the impersonation.
export function ActingBanner({ user }: { user: AuthenticatedUser | null }) {
  if (!user?.impersonatedBy) return null;
  return (
    <div
      role="status"
      className="border-b border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6 lg:px-8">
        <UserRoundCog className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{user.displayName}</span>
          {user.username ? (
            <>
              （<span className="font-mono">{user.username}</span>）
            </>
          ) : null}
          として操作中です。作った記録はこの会員のものになります。
        </span>
        <form action={stopActingAction}>
          <Button type="submit" size="sm" variant="outline">
            管理者に戻る
          </Button>
        </form>
      </div>
    </div>
  );
}
