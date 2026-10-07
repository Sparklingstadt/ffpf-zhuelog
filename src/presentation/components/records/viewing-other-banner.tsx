import Link from "next/link";
import { Alert, AlertDescription } from "@/presentation/components/ui/alert";

type Props = {
  // Display name of the viewed member, or the owner ID when there is none.
  name: string;
  // Link back to the same page without `?user=`.
  selfHref: string;
};

export function ViewingOtherBanner({ name, selfHref }: Props) {
  return (
    <Alert className="flex flex-wrap items-center justify-between gap-2">
      <AlertDescription className="text-foreground">
        {name}さんの記録を表示中（閲覧のみ）
      </AlertDescription>
      <Link
        href={selfHref}
        className="text-sm font-medium underline underline-offset-4"
      >
        自分の記録に戻る
      </Link>
    </Alert>
  );
}
