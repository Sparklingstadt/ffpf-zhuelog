import { ArrowLeft, Languages, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getRecordOwner } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import {
  emptyLearningTrashAction,
  purgeLearningEntryAction,
  restoreLearningEntryAction,
} from "@/presentation/actions/note-trash-actions";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { ReauthNotice } from "@/presentation/components/chat/reauth-notice";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import { NoteActionForm } from "@/presentation/components/records/note-action-form";
import {
  TrashEmpty,
  TrashOverflow,
  purgeConfirmMessage,
  emptyConfirmMessage,
} from "@/presentation/components/records/trash-list";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

// Always the signed-in user's own trash: `?user=` is not read, so an admin
// cannot open someone else's.
export default async function LearningTrashPage() {
  const { user, owner } = await getRecordOwner(undefined);
  if (!user || (owner.kind === "denied" && owner.reason === "unauthenticated"))
    redirect("/signin?callbackUrl=/logs/trash");
  if (owner.kind === "denied" && owner.reason === "guest") redirect("/");

  const trash =
    owner.kind === "self"
      ? await learningUseCases.listTrashedEntries.execute(owner.ownerId)
      : null;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="gap-1.5">
              <Languages className="size-3.5" /> Learning notes trash
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                学習ノートのゴミ箱
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
              <Link href="/logs">
                <ArrowLeft /> 日付一覧へ
              </Link>
            </Button>
            {trash && trash.total > 0 ? (
              <NoteActionForm
                action={emptyLearningTrashAction}
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
          <ReauthNotice subject="学習ノート" />
        ) : trash.entries.length === 0 ? (
          <TrashEmpty />
        ) : (
          <>
            <TrashOverflow shown={trash.entries.length} total={trash.total} />
            <div className="grid gap-4">
              {trash.entries.map((entry) => (
                <LearningEntryCard
                  key={entry.id}
                  entry={entry}
                  numberLabel={formatTokyoDateTime(entry.createdAt)}
                  defaultOpen={false}
                  actions={
                    <>
                      <span className="self-center text-xs text-muted-foreground">
                        ゴミ箱に入れた日時：
                        <time dateTime={entry.deletedAt.toISOString()}>
                          {formatTokyoDateTime(entry.deletedAt)}
                        </time>
                      </span>
                      <NoteActionForm
                        action={restoreLearningEntryAction}
                        fields={{ id: entry.id }}
                        label="元に戻す"
                        pendingLabel="戻しています…"
                        icon={<RotateCcw />}
                      />
                      <NoteActionForm
                        action={purgeLearningEntryAction}
                        fields={{ id: entry.id }}
                        label="完全に削除"
                        pendingLabel="削除中…"
                        icon={<Trash2 />}
                        variant="destructive"
                        confirmMessage={purgeConfirmMessage}
                      />
                    </>
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
