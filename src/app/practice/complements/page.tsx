import { History, ListChecks } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentViewerUser } from "@/composition/identity-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import {
  COMPLEMENT_MODES,
  type ComplementMode,
  countComplementQuestions,
} from "@/domain/practice/complement-quiz";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";

export const dynamic = "force-dynamic";
export default async function ComplementModesPage() {
  const user = await getCurrentViewerUser();
  if (!user) redirect("/signin?callbackUrl=/practice/complements");
  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={ListChecks}
        eyebrow="Complement practice"
        title="補語の練習"
        description="練習する補語を選んでください。各100問から毎回25問を4択で出題します。正答率・ミス数・経過時間を確認できます。"
        actions={
          isMemberRole(user.role) ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/practice/complements/records">
                <History />
                過去の記録
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {Object.entries(COMPLEMENT_MODES).map(([mode, info]) => (
          <Card key={mode}>
            <CardContent className="flex h-full flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-xl font-semibold">{info.label}</h2>
                <Badge variant="secondary" className="shrink-0">
                  全{countComplementQuestions(mode as ComplementMode)}問
                </Badge>
              </div>
              <p className="flex-1 text-sm leading-6 text-muted-foreground">
                {info.description}
              </p>
              <Button asChild>
                <Link href={`/practice/complements/${mode}`}>
                  {info.label}を練習
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        名詞を数える量詞は、
        <Link
          href="/practice/measure-words"
          className="font-medium text-foreground underline underline-offset-4"
        >
          量詞の練習
        </Link>
        で練習できます。
      </p>
    </PageShell>
  );
}
