import { BookOpen, CircleHelp } from "lucide-react";
import Link from "next/link";
import { questionNotes } from "@/composition/question-container";
import { ChatUnavailableError } from "@/infrastructure/go-api/conversation-gateway";
import { requireChatUser } from "@/presentation/guards/chat-guard";
import { QuickQuestionInterface } from "@/presentation/components/chat/quick-question-interface";
import { EmptyState } from "@/presentation/components/layout/empty-state";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { Button } from "@/presentation/components/ui/button";
export const dynamic = "force-dynamic";

export default async function QuickQuestionPage() {
  const user = await requireChatUser("/signin?callbackUrl=/quick-question");
  let model: string | null = null;
  try {
    model = (await questionNotes.list()).chatModel;
  } catch (error) {
    if (!(error instanceof ChatUnavailableError)) throw error;
  }
  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={CircleHelp}
        eyebrow="Quick question"
        title="クイック質問"
        description="文法や単語の疑問を、1回の質問で解決。質問と回答は質問ノートに残ります。"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/questions">
              <BookOpen />
              質問ノート
            </Link>
          </Button>
        }
      />
      {model ? (
        <QuickQuestionInterface chatModel={model} />
      ) : (
        <EmptyState
          icon={CircleHelp}
          title="クイック質問を利用できません"
          description="質問サービスの設定後に利用できます。"
        />
      )}
    </PageShell>
  );
}
