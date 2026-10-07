import { Trash2 } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription } from "@/presentation/components/ui/alert";
import { Button } from "@/presentation/components/ui/button";

// Header button to the signed-in user's own trash.
export function TrashLink({ href }: { href: string }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>
        <Trash2 /> ゴミ箱
      </Link>
    </Button>
  );
}

// Shown on a day's list right after one of its notes went to the trash.
export function TrashNotice({ href }: { href: string }) {
  return (
    <Alert className="flex flex-wrap items-center justify-between gap-2">
      <AlertDescription className="text-foreground">
        ゴミ箱に入れました。ゴミ箱から元に戻せます。
      </AlertDescription>
      <Link
        href={href}
        className="text-sm font-medium underline underline-offset-4"
      >
        ゴミ箱を開く
      </Link>
    </Alert>
  );
}
