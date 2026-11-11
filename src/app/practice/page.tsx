import { ArrowRight, History } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import {
  complementRecords,
  prepositionRecords,
} from "@/composition/practice-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import {
  ASPECT_PARTICLE_PRACTICE,
  countAspectParticleQuestions,
} from "@/domain/practice/aspect-particle-quiz";
import { COMPLEMENT_MODES } from "@/domain/practice/complement-quiz";
import { HSK_BASES } from "@/domain/practice/hsk-level";
import {
  countMeasureWordQuestions,
  MEASURE_WORD_PRACTICE,
} from "@/domain/practice/measure-word-quiz";
import { formatElapsed } from "@/domain/practice/preposition-record";
import { countPrepositionQuestionsByLevel } from "@/domain/practice/preposition-quiz";
import { GoApiError } from "@/infrastructure/go-api/client";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import {
  formatTokyoDateTime,
  formatTokyoMonthDay,
} from "@/presentation/presenters/log-date-presenter";
import {
  latestByKind,
  mergeRounds,
  type PracticeKind,
  type RoundRow,
} from "@/presentation/presenters/practice-overview-presenter";

export const dynamic = "force-dynamic";

// How many recent rounds the page lists.
const RECENT_COUNT = 5;

type Practice = {
  kind: PracticeKind;
  title: string;
  description: string;
  // 「309問」「8種類」.
  size: string;
  href: string;
  recordsHref: string;
};

const prepositionTotal = Object.values(
  countPrepositionQuestionsByLevel(HSK_BASES[0]),
).reduce((sum, n) => sum + n, 0);

const PRACTICES: Practice[] = [
  {
    kind: "preposition",
    title: "介詞",
    description:
      "名詞と日本語の意味から、空欄に入る介詞を選びます。HSK 4〜6級ごとにも練習できます。例：（在）图书馆学习。",
    size: `${prepositionTotal}問`,
    href: "/practice/prepositions",
    recordsHref: "/practice/prepositions/records",
  },
  {
    kind: "complement",
    title: "補語",
    description:
      "結果・可能・程度・方向補語などから選び、HSK 4〜6級ごとにも練習できます。例：听（懂）了。",
    size: `${Object.keys(COMPLEMENT_MODES).length}種類`,
    href: "/practice/complements",
    recordsHref: "/practice/complements/records",
  },
  {
    kind: "measure",
    title: MEASURE_WORD_PRACTICE.label,
    description: MEASURE_WORD_PRACTICE.description,
    size: `${countMeasureWordQuestions()}問`,
    href: "/practice/measure-words",
    recordsHref: "/practice/complements/records",
  },
  {
    kind: "aspect",
    title: ASPECT_PARTICLE_PRACTICE.label,
    description: ASPECT_PARTICLE_PRACTICE.description,
    size: `${countAspectParticleQuestions()}問`,
    href: "/practice/aspect-particles",
    recordsHref: "/practice/complements/records",
  },
];

// The saved rounds of both kinds, or none when Go cannot say: the cards
// then just leave out the last round.
async function loadRounds(): Promise<RoundRow[]> {
  try {
    const [prepositions, complements] = await Promise.all([
      prepositionRecords.list(),
      complementRecords.list(),
    ]);
    return mergeRounds(prepositions, complements);
  } catch (error) {
    if (!(error instanceof GoApiError)) throw error;
    console.error("PRACTICE_RECORDS_UNAVAILABLE", error.status, error.code);
    return [];
  }
}

// The practices in one place, for the bottom tab and the header's 練習:
// each with its last round, and the latest rounds of all below. Guests may
// practice; only members' and admins' rounds are recorded.
export default async function PracticePage() {
  const user = await getCurrentViewerUser();
  if (!user) redirect("/signin?callbackUrl=/practice");
  const canSave = isMemberRole(user.role);
  const rounds = canSave ? await loadRounds() : [];
  const latest = latestByKind(rounds);

  return (
    <PageShell user={user} width="5xl">
      <PageHeader
        title="文法の練習"
        description="4つの選択肢から正しい語を選ぶ練習です。1回25問で、間違えた問題は今日の復習に入ります。"
        actions={null}
        dense
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {PRACTICES.map((practice) => {
          const last = latest[practice.kind];
          return (
            <Card key={practice.href} className="py-5">
              <CardContent className="flex h-full flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="flex-1 text-xl font-semibold">
                    {practice.title}
                  </h2>
                  <Badge variant="secondary" className="font-normal">
                    {practice.size}
                  </Badge>
                </div>
                <p className="flex-1 text-sm leading-6 text-muted-foreground">
                  {practice.description}
                </p>
                {canSave ? (
                  <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                    <div className="flex gap-1.5">
                      <dt>前回の正答率</dt>
                      <dd className="font-semibold text-foreground tabular-nums">
                        {last ? `${last.accuracy}%` : "—"}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>最後に練習</dt>
                      <dd className="font-semibold text-foreground tabular-nums">
                        {last ? formatTokyoMonthDay(last.createdAt) : "まだ"}
                      </dd>
                    </div>
                  </dl>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild>
                    <Link href={practice.href}>
                      {practice.title}を練習 <ArrowRight />
                    </Link>
                  </Button>
                  {canSave ? (
                    <Button asChild variant="ghost">
                      <Link href={practice.recordsHref}>
                        <History /> 記録
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {!canSave ? (
        <p className="text-sm text-muted-foreground">
          ゲストの練習は記録に残りません。
        </p>
      ) : rounds.length > 0 ? (
        <section
          aria-labelledby="recent-rounds"
          className="overflow-hidden rounded-xl border bg-card"
        >
          <h2
            id="recent-rounds"
            className="px-4 py-3 text-sm font-semibold sm:px-5"
          >
            最近の記録
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-1.5 text-left font-medium sm:px-5">
                    日時
                  </th>
                  <th className="px-4 py-1.5 text-left font-medium">練習</th>
                  <th className="px-4 py-1.5 text-right font-medium">正答率</th>
                  <th className="px-4 py-1.5 text-right font-medium">ミス</th>
                  <th className="px-4 py-1.5 text-right font-medium sm:pr-5">
                    時間
                  </th>
                </tr>
              </thead>
              <tbody>
                {rounds.slice(0, RECENT_COUNT).map((round) => (
                  <tr key={round.id} className="border-t">
                    <td className="px-4 py-2.5 whitespace-nowrap sm:px-5">
                      <Link
                        href={round.href}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {formatTokyoDateTime(round.createdAt)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {round.label}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      {round.accuracy}%
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {round.missCount}回
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground sm:pr-5">
                      {formatElapsed(round.elapsedMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}
