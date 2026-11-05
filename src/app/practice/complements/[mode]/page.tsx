import { ArrowLeft, History, ListChecks } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentViewerUser } from "@/composition/identity-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import {
  buildComplementQuiz,
  COMPLEMENT_MODES,
  isComplementMode,
} from "@/domain/practice/complement-quiz";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { ComplementPractice } from "@/presentation/components/practice/complement-practice";
import { Button } from "@/presentation/components/ui/button";

export const dynamic = "force-dynamic";
export default async function ComplementQuizPage({
  params,
}: {
  params: Promise<{ mode: string }>;
}) {
  const { mode } = await params;
  if (!isComplementMode(mode)) notFound();
  const user = await getCurrentViewerUser();
  if (!user) redirect(`/signin?callbackUrl=/practice/complements/${mode}`);
  const canSave = isMemberRole(user.role);
  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={ListChecks}
        eyebrow="Complement practice"
        title={`${COMPLEMENT_MODES[mode].label}の練習`}
        description={`${COMPLEMENT_MODES[mode].description} 日本語の意味に合う補語を、4つの中から選んでください。`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/practice/complements">
                <ArrowLeft />
                種類を選ぶ
              </Link>
            </Button>
            {canSave ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/practice/complements/records">
                  <History />
                  過去の記録
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <ComplementPractice
        key={mode}
        initialQuiz={buildComplementQuiz(mode)}
        mode={mode}
        canSave={canSave}
      />
    </PageShell>
  );
}
