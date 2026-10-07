import { ArrowLeft, CalendarDays, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { conversationNoteUseCases } from "@/composition/conversation-container";
import { getCurrentMemberUser } from "@/composition/identity-container";
import {
  parseLogDate,
  parseLogNumber,
} from "@ffpf-zhuelog/core/domain/calendar/value-objects/log-date";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { ChatMessage } from "@/presentation/components/chat/chat-message";
import { ConversationDownloadButton } from "@/presentation/components/chat/conversation-download-button";
import { ReauthNotice } from "@/presentation/components/chat/reauth-notice";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import {
  formatLogDate,
  formatTokyoDateTime,
} from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

type ConversationDetailPageProps = {
  params: Promise<{ year: string; month: string; day: string; number: string }>;
};

export default async function ConversationDetailPage({
  params,
}: ConversationDetailPageProps) {
  const user = await getCurrentMemberUser();
  if (!user) redirect("/signin?callbackUrl=/conversations");

  const { year, month, day, number } = await params;
  const date = parseLogDate(year, month, day);
  const noteNumber = parseLogNumber(number);
  if (!date || !noteNumber) notFound();
  if (!user.githubId) return <ReauthPage />;

  const result = await conversationNoteUseCases.getDailyConversation.execute(
    user.githubId,
    date,
    noteNumber,
  );
  if (!result) notFound();
  const { conversation: note, total } = result;
  const createdAt = new Date(note.createdAt);
  const updatedAt = new Date(note.updatedAt);

  const dateHref = `/conversations/${date.year}/${date.month}/${date.day}`;
  const updated = updatedAt.getTime() - createdAt.getTime() >= 1_000;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-3">
            <Badge variant="secondary" className="gap-1.5">
              <MessagesSquare className="size-3.5" /> Daily conversation notes
            </Badge>
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold tracking-tight">
                {formatLogDate(date)} · #{noteNumber}
              </h1>
              <p className="mt-2 break-words text-sm text-muted-foreground">
                この日の{noteNumber}件目／全{total}件 · {note.messages.length}
                件のメッセージ
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={dateHref}>
                <ArrowLeft /> この日の一覧へ
              </Link>
            </Button>
            <AuthControls user={user} />
          </div>
        </header>

        <Card className="gap-0 py-0 shadow-xs">
          <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
            <div className="min-w-0 space-y-1">
              <h2 className="break-words font-medium">{note.title}</h2>
              <p className="text-xs text-muted-foreground">
                保存：
                <time dateTime={note.createdAt}>
                  {formatTokyoDateTime(createdAt)}
                </time>
                {updated ? (
                  <>
                    {" · 更新："}
                    <time dateTime={note.updatedAt}>
                      {formatTokyoDateTime(updatedAt)}
                    </time>
                  </>
                ) : null}
                {` · ${note.modelName}`}
                {note.ended ? " · 終了済み" : null}
              </p>
            </div>
            <ConversationDownloadButton conversation={note} />
          </div>
          <CardContent className="space-y-5 px-4 py-6 sm:px-6">
            {note.messages.map((message) => (
              <ChatMessage
                key={message.id}
                role={message.role}
                text={message.text}
              />
            ))}
          </CardContent>
        </Card>

        <nav
          className="flex items-center justify-between gap-3"
          aria-label="同じ日の会話ノート"
        >
          {noteNumber > 1 ? (
            <Button asChild variant="outline">
              <Link href={`${dateHref}/${noteNumber - 1}`}>
                <ArrowLeft /> 前のノート
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {noteNumber < total ? (
            <Button asChild variant="outline">
              <Link href={`${dateHref}/${noteNumber + 1}`}>
                <CalendarDays /> 次のノート
              </Link>
            </Button>
          ) : null}
        </nav>
      </div>
    </main>
  );
}

function ReauthPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <ReauthNotice />
      </div>
    </main>
  );
}
