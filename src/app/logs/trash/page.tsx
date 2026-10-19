import { ArrowLeft, Languages, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";

import { learningUseCases } from "@/composition/learning-container";
import {
  emptyLearningTrashAction,
  purgeLearningEntryAction,
  restoreLearningEntryAction,
} from "@/presentation/actions/note-trash-actions";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { ReauthNotice } from "@/presentation/components/auth/reauth-notice";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import { NoteActionForm } from "@/presentation/components/records/note-action-form";
import {
  TrashEmpty,
  TrashOverflow,
  purgeConfirmMessage,
  emptyConfirmMessage,
} from "@/presentation/components/records/trash-list";
import { Button } from "@/presentation/components/ui/button";
import { requireNonGuestOwner } from "@/presentation/guards/record-owner-guard";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

// Always the signed-in user's own trash: `?user=` is not read, so an admin
// cannot open someone else's.
export default async function LearningTrashPage() {
  const { user, owner } = await requireNonGuestOwner(
    undefined,
    "/signin?callbackUrl=/logs/trash",
  );

  const trash =
    owner.kind === "self"
      ? await learningUseCases.listTrashedEntries.execute(owner.ownerId)
      : null;

  return (
    <PageShell width="5xl">
      <PageHeader
        icon={Languages}
        eyebrow="Learning notes trash"
        title="学習ノートのゴミ箱"
        description={trash ? `ゴミ箱：${trash.total}件` : null}
        actions={
          <>
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
          </>
        }
      />

      {!trash ? (
        <ReauthNotice subject="学習ノート" />
      ) : trash.entries.length === 0 ? (
        <TrashEmpty />
      ) : (
        <>
          <TrashOverflow shown={trash.entries.length} total={trash.total} />
          <div className="grid gap-4">
            {trash.entries.map((entry) => (
              // The card stays closed, so its controls sit below it rather
              // than in its footer, which only shows once it is opened.
              <div key={entry.id} className="space-y-2">
                <LearningEntryCard
                  entry={entry}
                  numberLabel={formatTokyoDateTime(entry.createdAt)}
                  defaultOpen={false}
                />
                <div className="flex flex-wrap items-start justify-end gap-2">
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
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
