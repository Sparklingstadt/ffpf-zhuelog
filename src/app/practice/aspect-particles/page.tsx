import { History } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import {
  ASPECT_PARTICLE_PRACTICE,
  buildAspectParticleQuiz,
  countAspectParticleQuestions,
} from "@/domain/practice/aspect-particle-quiz";
import { parseHskLevel } from "@/domain/practice/hsk-level";
import { readHskBasis } from "@/infrastructure/preferences/hsk-basis-cookie";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { AspectParticlePractice } from "@/presentation/components/practice/aspect-particle-practice";
import { HskBasisSwitch } from "@/presentation/components/practice/hsk-basis-switch";
import { HskLevelPicker } from "@/presentation/components/practice/hsk-level-picker";
import { Button } from "@/presentation/components/ui/button";

export const dynamic = "force-dynamic";

const PATH = "/practice/aspect-particles";

export default async function AspectParticlePracticePage({
  searchParams,
}: PageProps<"/practice/aspect-particles">) {
  const level = parseHskLevel((await searchParams).hsk);
  const returnTo = `${PATH}${level ? `?hsk=${level}` : ""}`;
  const user = await getCurrentViewerUser();
  if (!user) redirect(`/signin?callbackUrl=${encodeURIComponent(returnTo)}`);
  const canSave = isMemberRole(user.role);
  const basis = await readHskBasis();
  const filter = level ? { level, basis } : null;
  const counts = {
    4: countAspectParticleQuestions({ level: 4, basis }),
    5: countAspectParticleQuestions({ level: 5, basis }),
    6: countAspectParticleQuestions({ level: 6, basis }),
  };
  const quiz = buildAspectParticleQuiz(25, Math.random, filter);
  return (
    <PageShell user={user} width="4xl" dense>
      <PageHeader
        dense
        title="了・过・着の練習"
        description={`${ASPECT_PARTICLE_PRACTICE.description} 日本語の意味に合うものを、4つの中から選んでください。HSK の級は、文のいちばん難しい語で決めています。`}
        actions={
          canSave ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/practice/complements/records">
                <History />
                過去の記録
              </Link>
            </Button>
          ) : undefined
        }
      />
      <HskLevelPicker
        path={PATH}
        current={level}
        counts={counts}
        total={countAspectParticleQuestions()}
      />
      <HskBasisSwitch current={basis} returnTo={returnTo} />
      {quiz.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          この級の問題はまだありません。
        </p>
      ) : (
        <AspectParticlePractice
          key={`${basis}:${level ?? "all"}`}
          initialQuiz={quiz}
          canSave={canSave}
          filter={filter}
        />
      )}
    </PageShell>
  );
}
