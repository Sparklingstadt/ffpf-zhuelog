import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { parseHskLevel } from "@/domain/practice/hsk-level";
import {
  buildMeasureWordQuiz,
  countMeasureWordQuestions,
  MEASURE_WORD_PRACTICE,
} from "@/domain/practice/measure-word-quiz";
import { readHskBasis } from "@/infrastructure/preferences/hsk-basis-cookie";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { HskBasisSwitch } from "@/presentation/components/practice/hsk-basis-switch";
import { HskLevelPicker } from "@/presentation/components/practice/hsk-level-picker";
import { PracticeBar } from "@/presentation/components/practice/practice-bar";
import { MeasureWordPractice } from "@/presentation/components/practice/measure-word-practice";

export const dynamic = "force-dynamic";

const PATH = "/practice/measure-words";

export default async function MeasureWordPracticePage({
  searchParams,
}: PageProps<"/practice/measure-words">) {
  const level = parseHskLevel((await searchParams).hsk);
  const returnTo = `${PATH}${level ? `?hsk=${level}` : ""}`;
  const user = await getCurrentViewerUser();
  if (!user) redirect(`/signin?callbackUrl=${encodeURIComponent(returnTo)}`);
  const canSave = isMemberRole(user.role);
  const basis = await readHskBasis();
  const filter = level ? { level, basis } : null;
  const counts = {
    4: countMeasureWordQuestions({ level: 4, basis }),
    5: countMeasureWordQuestions({ level: 5, basis }),
    6: countMeasureWordQuestions({ level: 6, basis }),
  };
  const quiz = buildMeasureWordQuiz(25, Math.random, filter);
  return (
    <PageShell user={user} width="4xl" dense>
      <PracticeBar
        title="量詞の練習"
        description={`${MEASURE_WORD_PRACTICE.description} 全${countMeasureWordQuestions()}問から毎回25問を、4つの中から選んでください。`}
        exitHref="/practice"
        recordsHref={canSave ? "/practice/complements/records" : null}
        levels={
          <HskLevelPicker
            path={PATH}
            current={level}
            counts={counts}
            total={countMeasureWordQuestions()}
          />
        }
      />
      <HskBasisSwitch current={basis} returnTo={returnTo} />
      {quiz.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          この級の問題はまだありません。
        </p>
      ) : (
        <MeasureWordPractice
          key={`${basis}:${level ?? "all"}`}
          initialQuiz={quiz}
          canSave={canSave}
          filter={filter}
        />
      )}
    </PageShell>
  );
}
