import { CircleUserRound, Eye, LogOut } from "lucide-react";

import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { signOutAction } from "@/presentation/actions/auth-actions";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";

type AuthControlsProps = {
  user: AuthenticatedUser;
};

export function AuthControls({ user }: AuthControlsProps) {
  const isGuest = user.role === "guest";

  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="gap-1.5 py-1.5 font-normal">
        {isGuest ? (
          <Eye className="size-3.5" />
        ) : (
          <CircleUserRound className="size-3.5" />
        )}
        {isGuest ? "ゲスト（共有ノートは閲覧のみ）" : `@${user.githubLogin}`}
      </Badge>
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="sm">
          <LogOut />
          ログアウト
        </Button>
      </form>
    </div>
  );
}
