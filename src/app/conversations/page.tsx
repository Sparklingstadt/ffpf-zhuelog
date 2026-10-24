import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  MessageCircle,
  MessagesSquare,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/presentation/components/layout/empty-state";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import {
  loadConversationList,
  requireChatAdmin,
} from "@/presentation/guards/chat-admin-guard";
import { listConversationDates } from "@/presentation/presenters/conversation-dates";
import {
  formatLogDateKey,
  getLogDateHref,
} from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

export default async function ConversationsPage() {
  const user = await requireChatAdmin("/signin?callbackUrl=/conversations");
  const conversations = await loadConversationList();
  const dates = conversations ? listConversationDates(conversations) : [];

  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={MessagesSquare}
        eyebrow="Conversation notes"
        title="会話ノート"
        description="ChatGPTとの会話を、話した日から見返せます。"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft /> 学習ノートへ
              </Link>
            </Button>
            {conversations ? (
              <Button asChild size="sm">
                <Link href="/chat">
                  <MessageCircle /> ChatGPT と話す
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {!conversations ? (
        <EmptyState
          icon={MessageCircle}
          title="ChatGPT が設定されていません"
          description="Go API に OPENAI_API_KEY を設定すると、会話ノートを使えます。"
        />
      ) : dates.length === 0 ? (
        <EmptyState icon={CalendarDays} title="まだ会話ノートがありません" />
      ) : (
        <div className="grid gap-3">
          {dates.map((group) => (
            <Link
              key={formatLogDateKey(group.date)}
              href={getLogDateHref(group.date, "/conversations")}
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
                        {group.count}件の会話
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
    </PageShell>
  );
}
