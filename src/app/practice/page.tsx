import {
  ArrowLeft,
  History,
  Hourglass,
  ListChecks,
  Ruler,
  Shuffle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { ASPECT_PARTICLE_PRACTICE } from "@/domain/practice/aspect-particle-quiz";
import { COMPLEMENT_MODES } from "@/domain/practice/complement-quiz";
import { MEASURE_WORD_PRACTICE } from "@/domain/practice/measure-word-quiz";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";

export const dynamic = "force-dynamic";

type Practice = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  recordsHref: string;
};

const PRACTICES: Practice[] = [
  {
    title: "介詞",
    description:
      "名詞と日本語の意味から、空欄に入る介詞を選びます。HSK 4〜6級ごとにも練習できます。例：（在）图书馆学习。",
    href: "/practice/prepositions",
    icon: Shuffle,
    recordsHref: "/practice/prepositions/records",
  },
  {
    title: "補語",
    description: `結果・可能・程度・方向補語など${Object.keys(COMPLEMENT_MODES).length}つのモードから選び、HSK 4〜6級ごとにも練習できます。例：听（懂）了。`,
    href: "/practice/complements",
    icon: ListChecks,
    recordsHref: "/practice/complements/records",
  },
  {
    title: MEASURE_WORD_PRACTICE.label,
    description: MEASURE_WORD_PRACTICE.description,
    href: "/practice/measure-words",
    icon: Ruler,
    recordsHref: "/practice/complements/records",
  },
  {
    title: ASPECT_PARTICLE_PRACTICE.label,
    description: ASPECT_PARTICLE_PRACTICE.description,
    href: "/practice/aspect-particles",
    icon: Hourglass,
    recordsHref: "/practice/complements/records",
  },
];

// The practices in one place, for the bottom tab and the header's 練習.
// Guests may practice; only members' and admins' rounds are recorded.
export default async function PracticePage() {
  const user = await getCurrentViewerUser();
  if (!user) redirect("/signin?callbackUrl=/practice");
  const canSave = isMemberRole(user.role);

  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={ListChecks}
        eyebrow="Practice"
        title="文法の練習"
        description="4つの選択肢から正しい語を選ぶ練習です。1回25問で、正答率・ミス数・経過時間がわかります。"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/">
              <ArrowLeft /> ホームへ
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {PRACTICES.map((practice) => (
          <Card key={practice.href}>
            <CardContent className="flex h-full flex-col gap-4">
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <practice.icon
                  className="size-5 text-primary"
                  aria-hidden="true"
                />
                {practice.title}
              </h2>
              <p className="flex-1 text-sm leading-6 text-muted-foreground">
                {practice.description}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href={practice.href}>{practice.title}を練習</Link>
                </Button>
                {canSave ? (
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="self-center"
                  >
                    <Link href={practice.recordsHref}>
                      <History /> 記録
                    </Link>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
