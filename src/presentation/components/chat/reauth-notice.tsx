import { KeyRound } from "lucide-react";

import { Card, CardContent } from "@/presentation/components/ui/card";

// Saved conversations belong to the stable GitHub ID, which older sessions lack.
export function ReauthNotice() {
  return (
    <Card className="border-dashed py-12 text-center shadow-none">
      <CardContent>
        <KeyRound className="mx-auto size-7 text-muted-foreground" />
        <p className="mt-3 font-medium">再ログインが必要です</p>
        <p className="mt-1 text-sm text-muted-foreground">
          会話ノートを表示するには、一度ログアウトしてGitHubでログインし直してください。
        </p>
      </CardContent>
    </Card>
  );
}
