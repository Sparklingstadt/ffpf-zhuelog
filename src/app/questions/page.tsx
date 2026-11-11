import { BookOpen, ChevronRight, CircleHelp, Plus } from "lucide-react";
import Link from "next/link";
import { questionNotes } from "@/composition/question-container";
import { ChatUnavailableError } from "@/infrastructure/go-api/conversation-gateway";
import type { QuestionSummary } from "@/domain/chat/question";
import { requireChatUser } from "@/presentation/guards/chat-guard";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";
import { AiSideNav } from "@/presentation/components/chat/ai-side-nav";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { EmptyState } from "@/presentation/components/layout/empty-state";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
export const dynamic = "force-dynamic";

export default async function QuestionsPage() {
  const user = await requireChatUser("/signin?callbackUrl=/questions");
  let questions: QuestionSummary[] | null = null;
  try {
    questions = (await questionNotes.list()).questions;
  } catch (error) {
    if (!(error instanceof ChatUnavailableError)) throw error;
  }
  return (
    <PageShell user={user} width="6xl">
      <PageHeader
        title="質問ノート"
        description="クイック質問で解決した疑問を、新しい順に見返せます。最新100件を表示します。"
        dense
        actions={
          // Wide screens have the way to ask on the left instead.
          <Button asChild size="sm" className="lg:hidden">
            <Link href="/quick-question">
              <CircleHelp />
              クイック質問
            </Link>
          </Button>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <AiSideNav
          current="quick"
          showTabs={!user.demo}
          action={
            <Button asChild variant="outline" className="w-full">
              <Link href="/quick-question">
                <Plus /> 新しい質問
              </Link>
            </Button>
          }
        />
        <div className="min-w-0">
          {!questions ? (
            <EmptyState
              icon={CircleHelp}
              title="質問ノートを利用できません"
              description="質問サービスの設定後に利用できます。"
            />
          ) : !questions.length ? (
            <EmptyState
              icon={BookOpen}
              title="まだ質問ノートがありません"
              description="クイック質問をすると、ここに質問と回答が残ります。"
            />
          ) : (
            <div className="grid gap-3">
              {questions.map((q) => (
                <Link key={q.id} href={`/questions/${q.id}`} className="group">
                  <Card className="transition-colors group-hover:bg-muted/40">
                    <CardContent className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="line-clamp-2 break-words font-medium">
                          {q.question}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatTokyoDateTime(q.createdAt)}
                        </p>
                      </div>
                      <ChevronRight className="size-4 shrink-0" />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
