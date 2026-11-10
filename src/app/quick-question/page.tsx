import { BookOpen, CircleHelp } from "lucide-react";
import Link from "next/link";
import { questionNotes } from "@/composition/question-container";
import type { QuestionSummary } from "@/domain/chat/question";
import { ChatUnavailableError } from "@/infrastructure/go-api/conversation-gateway";
import { requireChatUser } from "@/presentation/guards/chat-guard";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";
import { AiSideNav } from "@/presentation/components/chat/ai-side-nav";
import { QuickQuestionInterface } from "@/presentation/components/chat/quick-question-interface";
import { EmptyState } from "@/presentation/components/layout/empty-state";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { Button } from "@/presentation/components/ui/button";
export const dynamic = "force-dynamic";

// How many recent question notes the left column lists.
const RECENT_COUNT = 8;

export default async function QuickQuestionPage() {
  const user = await requireChatUser("/signin?callbackUrl=/quick-question");
  let model: string | null = null;
  let recent: QuestionSummary[] = [];
  try {
    const notes = await questionNotes.list();
    model = notes.chatModel;
    recent = notes.questions.slice(0, RECENT_COUNT);
  } catch (error) {
    if (!(error instanceof ChatUnavailableError)) throw error;
  }
  return (
    <PageShell user={user} width="6xl">
      <PageHeader
        title="クイック質問"
        description="文法や単語の疑問を、1回の質問で解決。質問と回答は質問ノートに残ります。"
        actions={
          // Wide screens list the notes on the left instead.
          <Button asChild variant="outline" size="sm" className="lg:hidden">
            <Link href="/questions">
              <BookOpen />
              質問ノート
            </Link>
          </Button>
        }
        dense
      />
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <AiSideNav current="quick" showTabs={!user.demo} title="質問ノート">
          {recent.length > 0 ? (
            <ul className="space-y-1">
              {recent.map((q) => (
                <li key={q.id}>
                  <Link
                    href={`/questions/${q.id}`}
                    className="block rounded-md px-3 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="line-clamp-2 break-words">
                      {q.question}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {formatTokyoDateTime(q.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 text-sm text-muted-foreground">
              質問すると、ここに残ります。
            </p>
          )}
          <Link href="/questions" className="block px-3 text-sm">
            すべての質問ノート
          </Link>
        </AiSideNav>
        {model ? (
          <QuickQuestionInterface chatModel={model} />
        ) : (
          <EmptyState
            icon={CircleHelp}
            title="クイック質問を利用できません"
            description="質問サービスの設定後に利用できます。"
          />
        )}
      </div>
    </PageShell>
  );
}
