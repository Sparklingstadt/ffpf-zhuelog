import { BookOpenText, FileUp } from "lucide-react";
import Link from "next/link";

import { learningNotes } from "@/composition/learning-container";
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
  const { user } = await requireNonGuestOwner(
    undefined,
    "/signin?callbackUrl=/export",
  );

  // learningNotes reads the signed-in user's own notes.
  const entries = await learningNotes.listAll();

  return (
    <PageShell user={user} width="5xl">
      <PageHeader
        title="CSVでエクスポート"
        description="学習ノートを選んで、インポートと同じ形式のCSVファイルに書き出します。"
        dense
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/import">
              <FileUp /> CSVをインポート
            </Link>
          </Button>
        }
      />

      {entries.length === 0 ? (
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
