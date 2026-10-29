import { History, ListChecks } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentViewerUser } from "@/composition/identity-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { COMPLEMENT_MODES } from "@/domain/practice/complement-quiz";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
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
        description="練習する補語を選んでください。各25問の4択で、正答率・ミス数・経過時間を確認できます。"
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
              <h2 className="text-xl font-semibold">{info.label}</h2>
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
    </PageShell>
  );
}
