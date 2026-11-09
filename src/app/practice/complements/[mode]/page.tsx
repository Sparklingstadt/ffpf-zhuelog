import { ArrowLeft, History, ListChecks } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentViewerUser } from "@/composition/identity-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import {
  buildComplementQuiz,
  COMPLEMENT_MODES,
  countComplementQuestions,
  isComplementMode,
} from "@/domain/practice/complement-quiz";
import { parseHskLevel } from "@/domain/practice/hsk-level";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { ComplementPractice } from "@/presentation/components/practice/complement-practice";
import { readHskBasis } from "@/infrastructure/preferences/hsk-basis-cookie";
import { HskBasisSwitch } from "@/presentation/components/practice/hsk-basis-switch";
import { HskLevelPicker } from "@/presentation/components/practice/hsk-level-picker";
import { Button } from "@/presentation/components/ui/button";

export const dynamic = "force-dynamic";
export default async function ComplementQuizPage({
  params,
  searchParams,
}: PageProps<"/practice/complements/[mode]">) {
  const { mode } = await params;
  if (!isComplementMode(mode)) notFound();
  const level = parseHskLevel((await searchParams).hsk);
  const user = await getCurrentViewerUser();
  if (!user)
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/practice/complements/${mode}${level ? `?hsk=${level}` : ""}`)}`,
    );
  const canSave = isMemberRole(user.role);
  const basis = await readHskBasis();
  const filter = level ? { level, basis } : null;
  const counts = {
    4: countComplementQuestions(mode, { level: 4, basis }),
    5: countComplementQuestions(mode, { level: 5, basis }),
    6: countComplementQuestions(mode, { level: 6, basis }),
  };
  const quiz = buildComplementQuiz(mode, 25, Math.random, filter);
  return (
    <PageShell user={user} width="4xl" dense>
      <PageHeader
        dense
        icon={ListChecks}
        eyebrow="Complement practice"
        title={`${COMPLEMENT_MODES[mode].label}の練習`}
        description={`${COMPLEMENT_MODES[mode].description} 日本語の意味に合う補語を、4つの中から選んでください。HSK の級は、例文のいちばん難しい語で決めています。`}
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
      <HskLevelPicker
        path={`/practice/complements/${mode}`}
        current={level}
        counts={counts}
        total={countComplementQuestions(mode)}
      />
      <HskBasisSwitch
        current={basis}
        returnTo={`/practice/complements/${mode}${level ? `?hsk=${level}` : ""}`}
      />
      {quiz.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          この級の問題はまだありません。
        </p>
      ) : (
        <ComplementPractice
          key={`${mode}:${basis}:${level ?? "all"}`}
          initialQuiz={quiz}
          mode={mode}
          canSave={canSave}
          filter={filter}
        />
      )}
    </PageShell>
  );
}
