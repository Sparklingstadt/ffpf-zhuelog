import { FlaskConical } from "lucide-react";

import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { signOutAction } from "@/presentation/actions/auth-actions";
import { Button } from "@/presentation/components/ui/button";

// Shown on every page of the demo account, so visitors know what they are
// looking at and what will not work.
export function DemoBanner({ user }: { user: AuthenticatedUser | null }) {
  if (!user?.demo) return null;
  return (
    <div
      role="status"
      aria-label="デモアカウント"
      className="border-b border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6 lg:px-8">
        <FlaskConical className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          デモアカウントです。データは試している全員で共有され、毎晩元に戻ります。AI・LINE・フォローの機能は使えません。
        </span>
        <form action={signOutAction}>
          <Button type="submit" size="sm" variant="outline">
            デモを終える
          </Button>
        </form>
      </div>
    </div>
  );
}
