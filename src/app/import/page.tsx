import { ArrowLeft, Download, FileUp } from "lucide-react";
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
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={FileUp}
        eyebrow="CSV import"
        title="CSVをインポート"
        description="UTF-8のCSVファイルを選んで、自分の学習ノートに学習文を一括登録します。"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft /> ホームへ
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/export">
                <Download /> CSVでエクスポート
              </Link>
            </Button>
          </>
        }
      />

      {owner.kind !== "self" ? (
        <ReauthNotice subject="学習ノート" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>CSVファイル</CardTitle>
            <CardDescription>
              インポートした学習文は、ホームと日付一覧に表示されます。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <CsvImportForm />
            <CsvFormatGuide />
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
