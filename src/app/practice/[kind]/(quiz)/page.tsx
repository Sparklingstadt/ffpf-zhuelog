import { ArrowLeft, History } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { kindFromSlug, PRACTICE_KINDS } from "@/domain/practice/practice-kind";
import { buildQuiz } from "@/domain/practice/practice-quiz";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { Practice } from "@/presentation/components/practice/practice";
import { practiceKindIcon } from "@/presentation/components/practice/practice-kind-icon";
import { Button } from "@/presentation/components/ui/button";

export const dynamic = "force-dynamic";

// One kind of practice (/practice/prepositions, /practice/complements); any
// other segment is a 404. Uses no notes, so guests can practice too; only
// members' and admins' rounds are recorded.
export default async function PracticePage({
  params,
}: PageProps<"/practice/[kind]">) {
  const { kind: slug } = await params;
  const kind = kindFromSlug(slug);
  if (!kind) notFound();
  const config = PRACTICE_KINDS[kind];
  const user = await getCurrentViewerUser();
  if (!user) redirect(`/signin?callbackUrl=${config.path}`);
  const canSave = isMemberRole(user.role);

  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={practiceKindIcon(kind)}
        eyebrow={config.eyebrow}
        title={config.title}
        description={config.description}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft /> ホームへ
              </Link>
            </Button>
            {canSave ? (
              <Button asChild variant="outline" size="sm">
                <Link href={config.recordsPath}>
                  <History /> 過去の記録
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {/* Shuffled here so the server and browser render the same quiz. */}
      <Practice
        kind={kind}
        initialQuiz={buildQuiz(config.source, config.questionCount)}
        canSave={canSave}
      />
    </PageShell>
  );
}
