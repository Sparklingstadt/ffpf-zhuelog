import {
  ArrowLeft,
  Braces,
  Download,
  Keyboard,
  Quote,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import { extractTypleWords } from "@/domain/typle/typle-word-list";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { Alert, AlertDescription } from "@/presentation/components/ui/alert";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";

export const dynamic = "force-dynamic";

async function loadWords() {
  try {
    const { entries, total } =
      await learningUseCases.listRecentEntries.execute(1000);
    return {
      words: extractTypleWords(entries),
      sourceCount: entries.length,
      total,
      error: null,
    };
  } catch {
    console.error("TYPLE_WORDS_UNAVAILABLE");
    return {
      words: [],
      sourceCount: 0,
      total: 0,
      error:
        "学習ノートを読み込めませんでした。データベースの状態を確認してください。",
    };
  }
}

export default async function TyplePage() {
  const user = await getCurrentViewerUser();
  if (!user) redirect("/signin?callbackUrl=/typle");
  if (user.role !== "admin") redirect("/");

  const { words, sourceCount, total, error } = await loadWords();

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="gap-1.5">
              <Keyboard className="size-3.5" /> Typle bridge
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                Typle用の復習リスト
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                添削で増えた中国語と、ヒント内で引用された語を集めて、Typleの保存形式へ整えます。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft /> 学習ノートへ
              </Link>
            </Button>
            <AuthControls user={user} />
          </div>
        </header>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>参照したノート</CardDescription>
              <CardTitle className="font-mono text-3xl">
                {sourceCount}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / {total}件
                </span>
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>抽出した復習語</CardDescription>
              <CardTitle className="font-mono text-3xl">
                {words.length}語
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Typleでの入力</CardDescription>
              <CardTitle className="text-lg">中国語IME</CardTitle>
            </CardHeader>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <WandSparkles className="size-4" />
            </div>
            <CardTitle>自動生成された単語リスト</CardTitle>
            <CardDescription>
              表示文字と入力文字には中国語を、補足には元のヒント・例文・拼音を入れます。同じ語は1件にまとめます。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2">
                <Quote className="size-4" /> ヒントの「引用語」
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2">
                <Braces className="size-4" /> 添削で追加された語
              </span>
            </div>

            {words.length > 0 ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {words.slice(0, 20).map((word) => (
                    <div
                      key={word.display}
                      className="min-w-0 rounded-xl border bg-muted/30 p-4"
                    >
                      <p lang="zh-Hans" className="text-xl font-semibold">
                        {word.display}
                      </p>
                      <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                        {word.annotation}
                      </p>
                    </div>
                  ))}
                </div>
                {words.length > 20 ? (
                  <p className="text-sm text-muted-foreground">
                    先頭20語を表示しています。出力には全{words.length}
                    語が含まれます。
                  </p>
                ) : null}
                <Button asChild size="lg">
                  <a href="/api/typle/export" download>
                    <Download /> Typle互換JSONをダウンロード
                  </a>
                </Button>
              </>
            ) : (
              <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                抽出できる語がまだありません。ヒントに中国語を「」で記録するか、添削を追加してください。
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
