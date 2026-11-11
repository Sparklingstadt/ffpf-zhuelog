import { ArrowLeft, CircleHelp, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { questionNotes } from "@/composition/question-container";
import type { QuestionSummary } from "@/domain/chat/question";
import { ChatUnavailableError } from "@/infrastructure/go-api/conversation-gateway";
import { AiRecentList } from "@/presentation/components/chat/ai-recent-list";
import { AiSideNav } from "@/presentation/components/chat/ai-side-nav";
import { requireChatUser } from "@/presentation/guards/chat-guard";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";
import { ChatMessage } from "@/presentation/components/chat/chat-message";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
export const dynamic = "force-dynamic";

// How many recent questions the left column lists.
const RECENT_COUNT = 8;

async function loadRecent(): Promise<QuestionSummary[]> {
  try {
    return (await questionNotes.list()).questions.slice(0, RECENT_COUNT);
  } catch (error) {
    if (!(error instanceof ChatUnavailableError)) throw error;
    return [];
  }
}

export default async function QuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireChatUser("/signin?callbackUrl=/questions");
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
  )
    notFound();
  const [q, recent] = await Promise.all([questionNotes.get(id), loadRecent()]);
  if (!q) notFound();
  return (
    <PageShell user={user} width="6xl">
      <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <AiSideNav
          current="quick"
          showTabs={!user.demo}
          title="質問ノート"
          action={
            <Button asChild variant="outline" className="w-full">
              <Link href="/quick-question">
                <Plus /> 新しい質問
              </Link>
            </Button>
          }
        >
          <AiRecentList
            // The question on the right is left out of the list.
            items={recent
              .filter((r) => r.id !== q.id)
              .map((r) => ({
                id: r.id,
                label: r.question,
                href: `/questions/${r.id}`,
                at: r.createdAt,
              }))}
            empty="ほかの質問はまだありません。"
            allHref="/questions"
            allLabel="すべての質問ノート"
          />
        </AiSideNav>
        <div className="flex min-w-0 flex-col gap-4">
          <Link
            href="/questions"
            className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            質問ノートへ
          </Link>
          <PageHeader
            title="質問と回答"
            description={`${formatTokyoDateTime(q.createdAt)} · ${q.modelName}`}
            dense
            actions={
              // Wide screens have the way to ask on the left instead.
              <Button asChild size="sm" className="lg:hidden">
                <Link href="/quick-question">
                  <CircleHelp />
                  新しい質問
                </Link>
              </Button>
            }
          />
          <Card>
            <CardContent className="space-y-5">
              <ChatMessage role="user" text={q.question} />
              <ChatMessage role="assistant" text={q.answer} />
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
