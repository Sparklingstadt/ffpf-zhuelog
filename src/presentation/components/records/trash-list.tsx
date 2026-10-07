import { Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/presentation/components/ui/alert";
import { Card, CardContent } from "@/presentation/components/ui/card";

export const purgeConfirmMessage =
  "このノートを完全に削除します。元に戻せません。よろしいですか？";

export const emptyConfirmMessage = (total: number) =>
  `ゴミ箱の ${total} 件を完全に削除します。元に戻せません。よろしいですか？`;

export function TrashEmpty() {
  return (
    <Card className="border-dashed py-12 text-center shadow-none">
      <CardContent>
        <Trash2 className="mx-auto size-7 text-muted-foreground" />
        <p className="mt-3 font-medium">ゴミ箱は空です</p>
      </CardContent>
    </Card>
  );
}

// The trash page lists the newest notes only; say how many are not shown.
export function TrashOverflow({
  shown,
  total,
}: {
  shown: number;
  total: number;
}) {
  if (total <= shown) return null;
  return (
    <Alert>
      <AlertDescription className="text-foreground">
        古い {total - shown}{" "}
        件は表示していません。ゴミ箱を空にすると、表示していないものも含めて全部消えます。
      </AlertDescription>
    </Alert>
  );
}
