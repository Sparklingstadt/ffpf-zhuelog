import { Trash2 } from "lucide-react";

import { EmptyState } from "@/presentation/components/layout/empty-state";
import { Alert, AlertDescription } from "@/presentation/components/ui/alert";

export const purgeConfirmMessage =
  "このノートを完全に削除します。元に戻せません。よろしいですか？";

export const emptyConfirmMessage = (total: number) =>
  `ゴミ箱の ${total} 件を完全に削除します。元に戻せません。よろしいですか？`;

export function TrashEmpty() {
  return <EmptyState icon={Trash2} title="ゴミ箱は空です" />;
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
