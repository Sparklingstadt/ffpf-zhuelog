import { UserRoundCog } from "lucide-react";

import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { stopActingAction } from "@/presentation/actions/acting-actions";
import { Button } from "@/presentation/components/ui/button";

// Shown on every page while an admin acts as a member, so the admin always
// knows whose records they are changing and can get back in one click.
export function ActingBanner({ user }: { user: AuthenticatedUser | null }) {
  if (user?.role !== "admin" || !(user.actingAs || user.actAsIgnored))
    return null;
  const acting = user.actingAs;
  return (
    <div
      role="status"
      className={
        acting
          ? "border-b border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          : "border-b border-red-300 bg-red-100 text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
      }
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6 lg:px-8">
        <UserRoundCog className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {acting ? (
            <>
              <span className="font-medium">{acting.displayName}</span>（
              <span className="font-mono">{acting.loginId}</span>
              ）として操作中です。作った記録はこの会員のものになります。
            </>
          ) : (
            "会員として操作できませんでした。今は管理者自身として操作しています。管理者に戻ってください。"
          )}
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
