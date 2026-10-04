import { ArrowLeft, ChevronRight, Clock3, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { conversationNoteUseCases } from "@/composition/conversation-container";
import { getCurrentAdminUser } from "@/composition/identity-container";
import { parseLogDate } from "@ffpf-zhuelog/core/domain/calendar/value-objects/log-date";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { ReauthNotice } from "@/presentation/components/chat/reauth-notice";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import {
  formatLogDate,
  formatTokyoDateTime,
} from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

type ConversationDatePageProps = {
  params: Promise<{ year: string; month: string; day: string }>;
};

export default async function ConversationDatePage({
  params,
}: ConversationDatePageProps) {
  const user = await getCurrentAdminUser();
  if (!user) redirect("/signin?callbackUrl=/conversations");

  const { year, month, day } = await params;
  const date = parseLogDate(year, month, day);
  if (!date) notFound();

  const notes = user.githubId
    ? await conversationNoteUseCases.listDailyConversations.execute(
        user.githubId,
        date,
      )
    : [];
  const dateHref = `/conversations/${date.year}/${date.month}/${date.day}`;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="gap-1.5">
              <MessagesSquare className="size-3.5" /> Daily conversation notes
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {formatLogDate(date)}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                この日に保存した会話ノート：{notes.length}件
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/conversations">
                <ArrowLeft /> 日付一覧へ
              </Link>
            </Button>
            <AuthControls user={user} />
          </div>
        </header>

        {!user.githubId ? (
          <ReauthNotice />
        ) : notes.length === 0 ? (
          <Card className="border-dashed py-12 text-center shadow-none">
            <CardContent>
              <MessagesSquare className="mx-auto size-7 text-muted-foreground" />
              <p className="mt-3 font-medium">この日の会話ノートはありません</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {notes.map((note, index) => (
              <Link
                key={note.id}
                href={`${dateHref}/${index + 1}`}
                className="group"
              >
                <Card className="transition-colors group-hover:bg-muted/40">
                  <CardContent className="flex items-center gap-4">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      #{index + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate font-medium">{note.title}</p>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="size-3.5" />
                          <time dateTime={note.createdAt}>
                            {formatTokyoDateTime(new Date(note.createdAt))}
                          </time>
                        </span>
                        <span>{note.messageCount}件のメッセージ</span>
                        {note.ended ? <span>終了済み</span> : null}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
