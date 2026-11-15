import { Download } from "lucide-react";
import Link from "next/link";

import { ReauthNotice } from "@/presentation/components/auth/reauth-notice";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { CsvFormatGuide } from "@/presentation/components/learning/csv-format-guide";
import { CsvImportForm } from "@/presentation/components/learning/csv-import-form";
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";
import { requireNonGuestOwner } from "@/presentation/guards/record-owner-guard";

export const dynamic = "force-dynamic";

// Imports always go to the signed-in user's own notes: `?user=` is not read.
export default async function LearningCsvImportPage() {
  const { user, owner } = await requireNonGuestOwner(
    undefined,
    "/signin?callbackUrl=/import",
  );

  return (
    <PageShell user={user} width="6xl">
      <PageHeader
        title="CSVをインポート"
        description="UTF-8のCSVファイルを選んで、自分の学習ノートに学習文を一括登録します。"
        dense
        actions={null}
      />

      {owner.kind !== "self" ? (
        <ReauthNotice subject="学習ノート" />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>CSVファイル</CardTitle>
                <CardDescription>
                  インポートした学習文は、ホームと日付一覧に表示されます。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CsvImportForm />
              </CardContent>
            </Card>
            <Card className="py-5">
              <CardContent className="flex flex-wrap items-center gap-4">
                <div className="min-w-60 flex-1">
                  <h2 className="font-semibold">書き出す</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    学習ノートを選んで、取り込みと同じ形の CSV で保存します。
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link href="/export">
                    <Download /> CSVでエクスポート
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardContent>
              <CsvFormatGuide />
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
