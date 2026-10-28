import { ArrowLeft, CircleHelp } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { questionNotes } from "@/composition/question-container";
import { requireChatUser } from "@/presentation/guards/chat-guard";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";
import { ChatMessage } from "@/presentation/components/chat/chat-message";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
export const dynamic = "force-dynamic";

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
  const q = await questionNotes.get(id);
  if (!q) notFound();
  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={CircleHelp}
        eyebrow="Question notes"
        title="質問と回答"
        description={`${formatTokyoDateTime(q.createdAt)} · ${q.modelName}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/questions">
                <ArrowLeft />
                質問ノートへ
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/quick-question">
                <CircleHelp />
                新しい質問
              </Link>
            </Button>
          </>
        }
      />
      <Card>
        <CardContent className="space-y-5">
          <ChatMessage role="user" text={q.question} />
          <ChatMessage role="assistant" text={q.answer} />
        </CardContent>
      </Card>
    </PageShell>
  );
}
