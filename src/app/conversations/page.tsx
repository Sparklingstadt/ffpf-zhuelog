import { CalendarDays, ChevronRight, MessageCircle } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/presentation/components/layout/empty-state";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import {
  loadConversationList,
  requireChatUser,
} from "@/presentation/guards/chat-guard";
import {
  conversationsOn,
  listConversationDates,
} from "@/presentation/presenters/conversation-dates";
import {
  formatLogDate,
  formatLogDateKey,
  formatTokyoTime,
  getLogDateHref,
} from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

export default async function ConversationsPage() {
  const user = await requireChatUser("/signin?callbackUrl=/conversations");
  const conversations = await loadConversationList();
  const dates = conversations ? listConversationDates(conversations) : [];

  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        title="会話ノート"
        description="「ChatGPT と話す」で話した会話を、話した日ごとに見返せます。"
        actions={
          // The demo account cannot chat; it only reads the notes.
          conversations && !user.demo ? (
            <Button asChild size="sm">
              <Link href="/chat">
                <MessageCircle /> ChatGPT と話す
              </Link>
            </Button>
          ) : null
        }
        dense
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
        // Each day with its conversations, so the list shows what was
        // talked about; the day's own page is a link away.
        <div className="space-y-6">
          {dates.map((group) => {
            const dayHref = getLogDateHref(group.date, "/conversations");
            const key = formatLogDateKey(group.date);
            return (
              <section
                key={key}
                aria-labelledby={`day-${key}`}
                className="space-y-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id={`day-${key}`} className="text-sm font-semibold">
                    {formatLogDate(group.date)}
                  </h2>
                  <Link
                    href={dayHref}
                    className="flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    {group.count}件の会話
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Link>
                </div>
                <ul className="space-y-2">
                  {conversationsOn(conversations, group.date).map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`${dayHref}/${item.number}`}
                        className="group"
                      >
                        <Card className="py-3 transition-colors group-hover:bg-muted/40">
                          <CardContent className="space-y-1">
                            <p className="flex gap-2 text-xs text-muted-foreground">
                              <span>#{item.number}</span>
                              <span>{formatTokyoTime(item.createdAt)}</span>
                              {item.ended ? <span>読むだけ</span> : null}
                            </p>
                            <p className="line-clamp-2 font-medium break-words">
                              {item.title}
                            </p>
                          </CardContent>
                        </Card>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
