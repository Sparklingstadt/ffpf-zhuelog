import { ArrowLeft, CalendarDays, MessagesSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { conversationNoteUseCases } from "@/composition/conversation-container";
import { getRecordOwner } from "@/composition/identity-container";
import { loadRecordOwnerView } from "@/composition/record-owner-options";
import {
  parseLogDate,
  parseLogNumber,
} from "@ffpf-zhuelog/core/domain/calendar/value-objects/log-date";
import { trashConversationAction } from "@/presentation/actions/note-trash-actions";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { ChatMessage } from "@/presentation/components/chat/chat-message";
import { ConversationDownloadButton } from "@/presentation/components/chat/conversation-download-button";
import { ReauthNotice } from "@/presentation/components/chat/reauth-notice";
import { NoteActionForm } from "@/presentation/components/records/note-action-form";
import { RecordOwnerControls } from "@/presentation/components/records/record-owner-controls";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import {
  formatLogDate,
  formatTokyoDateTime,
} from "@/presentation/presenters/log-date-presenter";
import {
  requestedRecordOwner,
  withRecordOwner,
} from "@/presentation/presenters/record-owner-href";

export const dynamic = "force-dynamic";

type ConversationDetailPageProps = {
  params: Promise<{ year: string; month: string; day: string; number: string }>;
  searchParams: Promise<{ user?: string | string[] }>;
};

export default async function ConversationDetailPage({
  params,
  searchParams,
}: ConversationDetailPageProps) {
  const { user, owner } = await getRecordOwner(
    requestedRecordOwner((await searchParams).user),
  );
  if (!user || (owner.kind === "denied" && owner.reason === "unauthenticated"))
    redirect("/signin?callbackUrl=/conversations");
  if (owner.kind === "denied" && owner.reason === "guest") redirect("/");

  const { year, month, day, number } = await params;
  const date = parseLogDate(year, month, day);
  const noteNumber = parseLogNumber(number);
  if (!date || !noteNumber) notFound();
  const dateHref = `/conversations/${date.year}/${date.month}/${date.day}`;
  if (owner.kind === "redirect-self") redirect(`${dateHref}/${noteNumber}`);
  if (owner.kind === "denied") return <ReauthPage />;

  const [result, view] = await Promise.all([
    conversationNoteUseCases.getDailyConversation.execute(
      owner.ownerId,
      date,
      noteNumber,
    ),
    loadRecordOwnerView(user, owner),
  ]);
  if (!result) notFound();
  const { conversation: note, total } = result;
  const createdAt = new Date(note.createdAt);
  const updatedAt = new Date(note.updatedAt);

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
              <Link href={withRecordOwner(dateHref, owner)}>
                <ArrowLeft /> この日の一覧へ
              </Link>
            </Button>
            <AuthControls user={user} />
          </div>
        </header>

        {/* Switching owners lands on the day's list: the other person may
            have fewer notes that day, so this number could be missing. */}
        <RecordOwnerControls owner={owner} view={view} path={dateHref} />

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
            <div className="flex flex-wrap items-start gap-2">
              <ConversationDownloadButton conversation={note} />
              {/* Only your own notes: an admin viewing someone else reads only. */}
              {owner.kind === "self" ? (
                <NoteActionForm
                  action={trashConversationAction}
                  fields={{
                    id: note.id,
                    year: String(date.year),
                    month: String(date.month),
                    day: String(date.day),
                  }}
                  label="ゴミ箱に入れる"
                  pendingLabel="移動中…"
                  icon={<Trash2 />}
                />
              ) : null}
            </div>
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
              <Link
                href={withRecordOwner(`${dateHref}/${noteNumber - 1}`, owner)}
              >
                <ArrowLeft /> 前のノート
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {noteNumber < total ? (
            <Button asChild variant="outline">
              <Link
                href={withRecordOwner(`${dateHref}/${noteNumber + 1}`, owner)}
              >
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
