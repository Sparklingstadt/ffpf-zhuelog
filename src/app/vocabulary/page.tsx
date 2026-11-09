import { ArrowLeft, BookA, Database, Repeat, Trash2 } from "lucide-react";
import Link from "next/link";
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
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={BookA}
        eyebrow="Vocabulary"
        title="単語帳"
        description="覚えたい語句を入れておくと、今日の復習に出てきます。学習ノートの詳細からも入れられます。"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft /> ホームへ
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/review">
                <Repeat /> 今日の復習
              </Link>
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">語句を入れる</CardTitle>
          <CardDescription>
            「AIで下書き」でピンインと意味を埋め、直してから入れられます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VocabularyAddForm
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
            {entries.length}語
          </h2>
          <ul className="divide-y rounded-lg border">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-baseline gap-x-3">
                    <span lang="zh-CN" className="text-xl font-semibold">
                      {entry.word}
                    </span>
                    <SpeakButton text={entry.word} className="self-center" />
                    <span className="font-mono text-sm text-muted-foreground">
                      {entry.pinyin}
                    </span>
                  </p>
                  <p className="text-sm">{entry.meaning}</p>
                </div>
                <NoteActionForm
                  action={deleteVocabularyAction}
                  fields={{ id: entry.id }}
                  label="消す"
                  pendingLabel="消しています…"
                  icon={<Trash2 />}
                  confirmMessage={`「${entry.word}」を単語帳から消しますか？復習の記録も消えます。`}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
