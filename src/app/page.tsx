import {
  BookOpenText,
  CalendarDays,
  Database,
  Eye,
  Keyboard,
  Languages,
  MessageCircle,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import type { LearningEntry } from "@/domain/learning/entities/learning-entry";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { CsvFormatGuide } from "@/presentation/components/learning/csv-format-guide";
import { CsvImportForm } from "@/presentation/components/learning/csv-import-form";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/presentation/components/ui/alert";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";
import { getLogDateHref } from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

async function loadEntries(): Promise<{
  entries: LearningEntry[];
  total: number;
  databaseError: string | null;
}> {
  try {
    const result = await learningUseCases.listRecentEntries.execute(100);
    return { ...result, databaseError: null };
  } catch {
    console.error("LEARNING_ENTRIES_UNAVAILABLE");
    return {
      entries: [],
      total: 0,
      databaseError:
        "データベースに接続できません。READMEの手順でPostgreSQLを起動し、マイグレーションを実行してください。",
    };
  }
}

export default async function Home() {
  const user = await getCurrentViewerUser();
  if (!user) redirect("/signin");

  const { entries, total, databaseError } = await loadEntries();

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="gap-1.5">
              <Languages className="size-3.5" /> Chinese learning log
            </Badge>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                学习録
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                自分が書いた文と添削後の文を、ピン音や覚えるべきヒントと一緒に蓄積します。
              </p>
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <AuthControls user={user} />
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button asChild variant="outline" size="sm">
                <Link href="/practice">
                  <Sparkles /> 自分のAPIキーで添削
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/logs">
                  <CalendarDays /> 日付から見る
                </Link>
              </Button>
              {user.role === "admin" ? (
                <>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/typle">
                      <Keyboard /> Typle用リスト
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/chat">
                      <MessageCircle /> ChatGPTと話す
                    </Link>
                  </Button>
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-xs">
              <Database className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">登録済み</span>
              <strong className="font-mono text-lg">{total}</strong>
              <span className="text-muted-foreground">文</span>
            </div>
          </div>
        </header>

        {databaseError ? (
          <Alert variant="destructive">
            <Database />
            <AlertTitle>PostgreSQLの準備が必要です</AlertTitle>
            <AlertDescription>{databaseError}</AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="order-2 space-y-4 lg:order-1">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                学習ノート
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                新しく登録された文から最大100件を表示します。
              </p>
            </div>

            {entries.length === 0 ? (
              <Card className="border-dashed py-14 text-center shadow-none">
                <CardContent className="flex flex-col items-center gap-3">
                  <div className="rounded-full bg-muted p-3">
                    <BookOpenText className="size-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">まだ学習文がありません</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      CSVをインポートすると、ここに学習カードが並びます。
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {entries.map((entry, index) => (
                  <LearningEntryCard
                    key={entry.id}
                    entry={entry}
                    numberLabel={`#${total - index}`}
                    href={getLogDateHref(entry.createdAt)}
                    linkLabel="この日の一覧"
                  />
                ))}
              </div>
            )}
          </div>

          <aside className="order-1 lg:order-2 lg:sticky lg:top-8">
            {user.role === "admin" ? (
              <Card>
                <CardHeader>
                  <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Sparkles className="size-4" />
                  </div>
                  <CardTitle>CSVをインポート</CardTitle>
                  <CardDescription>
                    UTF-8のCSVファイルを選んで、学習文を一括登録します。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <CsvImportForm disabled={Boolean(databaseError)} />
                  <CsvFormatGuide />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Eye className="size-4" />
                  </div>
                  <CardTitle>共有ノートは閲覧専用</CardTitle>
                  <CardDescription>
                    ゲストは共有ノートを閲覧できます。投稿・CSVインポート・管理者用ChatGPTは利用できません。個人練習は「自分のAPIキーで添削」から利用できます。
                  </CardDescription>
                </CardHeader>
              </Card>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}
