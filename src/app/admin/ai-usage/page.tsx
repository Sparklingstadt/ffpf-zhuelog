import Link from "next/link";
import { redirect } from "next/navigation";

import { aiUsage, getCurrentAdminUser } from "@/composition/identity-container";
import {
  aiUsageFeatureLabel,
  isAiUsageMonth,
  shiftAiUsageMonth,
  summarizeAiUsage,
} from "@/domain/ai-usage/monthly-usage";
import { AppHeader } from "@/presentation/components/layout/app-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/presentation/components/ui/table";

export const dynamic = "force-dynamic";

const count = new Intl.NumberFormat("ja-JP");

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  return `${year}年${Number(m)}月`;
}

export default async function AdminAiUsagePage({
  searchParams,
}: PageProps<"/admin/ai-usage">) {
  const user = await getCurrentAdminUser();
  if (!user) redirect("/");
  const requested = (await searchParams).month;
  const month =
    typeof requested === "string" && isAiUsageMonth(requested)
      ? requested
      : undefined;

  const usage = await aiUsage.month(month);
  const summary = usage ? summarizeAiUsage(usage.totals) : null;

  return (
    <>
      <AppHeader user={user} />
      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
          <header className="space-y-2 border-b pb-6">
            <Link
              href="/admin/accounts"
              className="text-sm text-muted-foreground hover:underline"
            >
              ← アカウント管理へ戻る
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight">
              AI の利用量
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              LINE の添削・翻訳、ChatGPT
              との会話、クイック質問、単語帳の下書きで OpenAI
              を呼んだ回数とトークン数です。月は日本時間で区切ります。管理者が会員として操作したときの分は、管理者に数えます。
            </p>
          </header>

          {!usage || !summary ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              利用量を読めませんでした。Go API が最新かを確認してください。
            </p>
          ) : (
            <Card>
              <CardHeader>
                <nav
                  aria-label="月の切り替え"
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <Link
                    href={`/admin/ai-usage?month=${shiftAiUsageMonth(usage.month, -1)}`}
                    className="text-muted-foreground hover:underline"
                  >
                    ← 前の月
                  </Link>
                  <CardTitle className="text-lg">
                    {monthLabel(usage.month)}
                  </CardTitle>
                  <Link
                    href={`/admin/ai-usage?month=${shiftAiUsageMonth(usage.month, 1)}`}
                    className="text-muted-foreground hover:underline"
                  >
                    次の月 →
                  </Link>
                </nav>
                <CardDescription>
                  {summary.people.length === 0
                    ? "この月は、まだ使われていません。"
                    : `${summary.people.length}人が ${count.format(summary.requests)} 回使いました。`}
                </CardDescription>
              </CardHeader>
              {summary.people.length > 0 ? (
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>人・機能</TableHead>
                        <TableHead className="text-right">回数</TableHead>
                        <TableHead className="text-right">入力</TableHead>
                        <TableHead className="text-right">出力</TableHead>
                      </TableRow>
                    </TableHeader>
                    {summary.people.map((person) => (
                      <TableBody key={person.ownerId}>
                        <TableRow className="bg-muted/40 font-medium">
                          <TableCell>
                            {person.name}
                            <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                              {person.ownerId}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {count.format(person.requests)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {count.format(person.inputTokens)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {count.format(person.outputTokens)}
                          </TableCell>
                        </TableRow>
                        {person.rows.map((row) => (
                          <TableRow key={`${row.feature}:${row.model}`}>
                            <TableCell className="pl-6 text-muted-foreground">
                              {aiUsageFeatureLabel(row.feature)}
                              <span className="ml-2 font-mono text-xs">
                                {row.model}
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {count.format(row.requests)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {count.format(row.inputTokens)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {count.format(row.outputTokens)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    ))}
                    <TableFooter>
                      <TableRow>
                        <TableCell>合計</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {count.format(summary.requests)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {count.format(summary.inputTokens)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {count.format(summary.outputTokens)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </CardContent>
              ) : null}
            </Card>
          )}
        </div>
      </main>
    </>
  );
}
