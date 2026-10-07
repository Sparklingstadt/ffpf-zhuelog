import {
  ArrowLeft,
  Clock3,
  MessagesSquare,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { conversationNoteUseCases } from "@/composition/conversation-container";
import { getRecordOwner } from "@/composition/identity-container";
import {
  emptyConversationTrashAction,
  purgeConversationAction,
  restoreConversationAction,
} from "@/presentation/actions/note-trash-actions";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { ReauthNotice } from "@/presentation/components/chat/reauth-notice";
import { NoteActionForm } from "@/presentation/components/records/note-action-form";
import {
  TrashEmpty,
  TrashOverflow,
  emptyConfirmMessage,
  purgeConfirmMessage,
} from "@/presentation/components/records/trash-list";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

// Always the signed-in user's own trash: `?user=` is not read, so an admin
// cannot open someone else's.
export default async function ConversationTrashPage() {
  const { user, owner } = await getRecordOwner(undefined);
  if (!user || (owner.kind === "denied" && owner.reason === "unauthenticated"))
    redirect("/signin?callbackUrl=/conversations/trash");
  if (owner.kind === "denied" && owner.reason === "guest") redirect("/");

  const trash =
    owner.kind === "self"
      ? await conversationNoteUseCases.listTrashedConversations.execute(
          owner.ownerId,
        )
      : null;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="gap-1.5">
              <MessagesSquare className="size-3.5" /> Conversation notes trash
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                会話ノートのゴミ箱
              </h1>
              {trash ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  ゴミ箱：{trash.total}件
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/conversations">
                <ArrowLeft /> 日付一覧へ
              </Link>
            </Button>
            {trash && trash.total > 0 ? (
              <NoteActionForm
                action={emptyConversationTrashAction}
                label="ゴミ箱を空にする"
                pendingLabel="削除中…"
                icon={<Trash2 />}
                variant="destructive"
                confirmMessage={emptyConfirmMessage(trash.total)}
              />
            ) : null}
            <AuthControls user={user} />
          </div>
        </header>

        {!trash ? (
          <ReauthNotice />
        ) : trash.conversations.length === 0 ? (
          <TrashEmpty />
        ) : (
          <>
            <TrashOverflow
              shown={trash.conversations.length}
              total={trash.total}
            />
            <div className="grid gap-3">
              {trash.conversations.map((note) => (
                <Card key={note.id} className="shadow-xs">
                  <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="break-words font-medium">{note.title}</p>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="size-3.5" />
                          保存：
                          <time dateTime={note.createdAt}>
                            {formatTokyoDateTime(new Date(note.createdAt))}
                          </time>
                        </span>
                        <span>{note.messageCount}件のメッセージ</span>
                        <span>{note.modelName}</span>
                        <span>
                          ゴミ箱に入れた日時：
                          <time dateTime={note.deletedAt}>
                            {formatTokyoDateTime(new Date(note.deletedAt))}
                          </time>
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-start justify-end gap-2">
                      <NoteActionForm
                        action={restoreConversationAction}
                        fields={{ id: note.id }}
                        label="元に戻す"
                        pendingLabel="戻しています…"
                        icon={<RotateCcw />}
                      />
                      <NoteActionForm
                        action={purgeConversationAction}
                        fields={{ id: note.id }}
                        label="完全に削除"
                        pendingLabel="削除中…"
                        icon={<Trash2 />}
                        variant="destructive"
                        confirmMessage={purgeConfirmMessage}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
