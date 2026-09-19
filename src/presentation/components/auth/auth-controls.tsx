import { CircleUserRound, LogOut } from "lucide-react";

import { signOutAction } from "@/presentation/actions/auth-actions";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";

type AuthControlsProps = {
  githubLogin: string;
};

export function AuthControls({ githubLogin }: AuthControlsProps) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="gap-1.5 py-1.5 font-normal">
        <CircleUserRound className="size-3.5" />@{githubLogin}
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
