import { ArrowLeft, BookOpenText, Download, FileUp } from "lucide-react";
import Link from "next/link";

import { learningNotes } from "@/composition/learning-container";
import { ReauthNotice } from "@/presentation/components/auth/reauth-notice";
import { EmptyState } from "@/presentation/components/layout/empty-state";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { CsvExportForm } from "@/presentation/components/learning/csv-export-form";
import { Button } from "@/presentation/components/ui/button";
import { requireNonGuestOwner } from "@/presentation/guards/record-owner-guard";

export const dynamic = "force-dynamic";

// Always the signed-in user's own notes: `?user=` is not read, so an admin
// cannot export someone else's.
export default async function LearningCsvExportPage() {
  const { user, owner } = await requireNonGuestOwner(
    undefined,
    "/signin?callbackUrl=/export",
  );

  const entries = owner.kind === "self" ? await learningNotes.listAll() : null;

  return (
    <PageShell user={user} width="5xl">
      <PageHeader
        icon={Download}
        eyebrow="CSV export"
        title="CSVでエクスポート"
        description="学習ノートを選んで、インポートと同じ形式のCSVファイルに書き出します。"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft /> ホームへ
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/import">
                <FileUp /> CSVをインポート
              </Link>
            </Button>
          </>
        }
      />

      {!entries ? (
        <ReauthNotice subject="学習ノート" />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={BookOpenText}
          title="まだ学習文がありません"
          description="CSVをインポートすると、ここから選んで書き出せます。"
        />
      ) : (
        <CsvExportForm entries={entries} />
      )}
    </PageShell>
  );
}
