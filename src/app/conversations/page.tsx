import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  MessageCircle,
  MessagesSquare,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { conversationNoteUseCases } from "@/composition/conversation-container";
import { getRecordOwner } from "@/composition/identity-container";
import { loadRecordOwnerView } from "@/composition/record-owner-options";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { ReauthNotice } from "@/presentation/components/chat/reauth-notice";
import { RecordOwnerControls } from "@/presentation/components/records/record-owner-controls";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import {
  formatLogDateKey,
  getLogDateHref,
} from "@/presentation/presenters/log-date-presenter";
import {
  requestedRecordOwner,
  withRecordOwner,
} from "@/presentation/presenters/record-owner-href";

export const dynamic = "force-dynamic";

type ConversationsPageProps = {
  searchParams: Promise<{ user?: string | string[] }>;
};

export default async function ConversationsPage({
  searchParams,
}: ConversationsPageProps) {
  const { user, owner } = await getRecordOwner(
    requestedRecordOwner((await searchParams).user),
  );
  if (!user || (owner.kind === "denied" && owner.reason === "unauthenticated"))
    redirect("/signin?callbackUrl=/conversations");
  if (owner.kind === "denied" && owner.reason === "guest") redirect("/");
  if (owner.kind === "redirect-self") redirect("/conversations");

  const hasNotes = owner.kind === "self" || owner.kind === "other";
  const [dates, view] = hasNotes
    ? await Promise.all([
        conversationNoteUseCases.listConversationDates.execute(owner.ownerId),
        loadRecordOwnerView(user, owner),
      ])
    : [[], null];

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="gap-1.5">
              <MessagesSquare className="size-3.5" /> Conversation notes
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                会話ノート
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                ChatGPTとの会話練習を保存した日から一覧を開けます。
                {owner.kind === "other"
                  ? "表示中のユーザーが保存した会話だけが表示されます。"
                  : "自分が保存した会話だけが表示されます。"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={withRecordOwner("/", owner)}>
                <ArrowLeft /> 学習ノートへ
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/chat">
                <MessageCircle /> ChatGPTと話す
              </Link>
            </Button>
            <AuthControls user={user} />
          </div>
        </header>

        {view ? (
          <RecordOwnerControls
            owner={owner}
            view={view}
            path="/conversations"
          />
        ) : null}

        {!hasNotes ? (
          <ReauthNotice />
        ) : dates.length === 0 ? (
          <Card className="border-dashed py-12 text-center shadow-none">
            <CardContent>
              <MessagesSquare className="mx-auto size-7 text-muted-foreground" />
              <p className="mt-3 font-medium">まだ会話ノートがありません</p>
              <p className="mt-1 text-sm text-muted-foreground">
                会話練習の画面で「会話を保存する」を押すと、ここに追加されます。
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {dates.map((group) => (
              <Link
                key={formatLogDateKey(group.date)}
                href={withRecordOwner(
                  getLogDateHref(group.date, "/conversations"),
                  owner,
                )}
                className="group"
              >
                <Card className="transition-colors group-hover:bg-muted/40">
                  <CardContent className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                        <CalendarDays className="size-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">
                          {formatLogDateKey(group.date)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {group.count}件の会話ノート
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
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
