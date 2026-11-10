import { Database, Trash2 } from "lucide-react";
import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { vocabulary } from "@/composition/vocabulary-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import type { VocabularyEntry } from "@/domain/vocabulary/vocabulary-entry";
import { GoApiError } from "@/infrastructure/go-api/client";
import {
  deleteVocabularyAction,
  draftVocabularyAction,
  saveVocabularyAction,
} from "@/presentation/actions/vocabulary-actions";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { NoteActionForm } from "@/presentation/components/records/note-action-form";
import { SpeakButton } from "@/presentation/components/speech/speak-button";
import { Alert, AlertDescription } from "@/presentation/components/ui/alert";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";
import { VocabularyAddForm } from "@/presentation/components/vocabulary/vocabulary-add-form";
import { genericErrorMessage } from "@/presentation/presenters/generic-error-message";

export const dynamic = "force-dynamic";

// Go being unavailable (or failing) still shows the page with a notice. Any
// other error, including the redirect to /signin, is rethrown.
async function loadVocabulary(): Promise<VocabularyEntry[] | null> {
  try {
    return await vocabulary.list();
  } catch (error) {
    if (!(error instanceof GoApiError)) throw error;
    console.error("VOCABULARY_UNAVAILABLE", error.status, error.code);
    return null;
  }
}

// Members' and admins' own words. Guests have no book, so they go home.
export default async function VocabularyPage() {
  const user = await getCurrentViewerUser();
  if (!user) redirect("/signin?callbackUrl=/vocabulary");
  if (!isMemberRole(user.role)) redirect("/");
  const entries = await loadVocabulary();

  return (
    <PageShell user={user} width="6xl">
      <PageHeader
        title="単語帳"
        description="入れた語句は今日の復習に出てきます。学習ノートの詳細からも入れられます。"
        actions={null}
        dense
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">語句を入れる</CardTitle>
        </CardHeader>
        <CardContent>
          <VocabularyAddForm
            layout="row"
            draftVocabulary={draftVocabularyAction}
            saveVocabulary={saveVocabularyAction}
          />
        </CardContent>
      </Card>

      {entries === null ? (
        <Alert variant="destructive">
          <Database />
          <AlertDescription>{genericErrorMessage}</AlertDescription>
        </Alert>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだ単語がありません。</p>
      ) : (
        <section className="space-y-3" aria-label="単語の一覧">
          <h2 className="text-lg font-semibold tracking-tight">
            入れた語句{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {entries.length}語
            </span>
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-1 rounded-xl border bg-card px-5 py-4"
              >
                <div className="flex items-center gap-2">
                  <p
                    lang="zh-CN"
                    className="min-w-0 flex-1 truncate text-2xl font-semibold"
                  >
                    {entry.word}
                  </p>
                  <SpeakButton text={entry.word} />
                  <NoteActionForm
                    action={deleteVocabularyAction}
                    fields={{ id: entry.id }}
                    label="消す"
                    pendingLabel="消しています…"
                    icon={<Trash2 />}
                    confirmMessage={`「${entry.word}」を単語帳から消しますか？復習の記録も消えます。`}
                  />
                </div>
                <p className="text-sm text-muted-foreground">{entry.pinyin}</p>
                <p className="text-sm">{entry.meaning}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
