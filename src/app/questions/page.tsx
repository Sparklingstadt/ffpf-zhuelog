import { BookOpen, ChevronRight, CircleHelp } from "lucide-react";
import Link from "next/link";
import { questionNotes } from "@/composition/question-container";
import { ChatUnavailableError } from "@/infrastructure/go-api/conversation-gateway";
import type { QuestionSummary } from "@/domain/chat/question";
import { requireChatUser } from "@/presentation/guards/chat-guard";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";
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
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={BookOpen}
        eyebrow="Question notes"
        title="質問ノート"
        description="クイック質問で解決した疑問を、新しい順に見返せます。最新100件を表示します。"
        actions={
          <Button asChild size="sm">
            <Link href="/quick-question">
              <CircleHelp />
              クイック質問
            </Link>
          </Button>
        }
      />
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
    </PageShell>
  );
}
