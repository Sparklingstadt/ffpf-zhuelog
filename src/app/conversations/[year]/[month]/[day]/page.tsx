import { ArrowLeft, ChevronRight, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { parseLogDate } from "@/domain/calendar/value-objects/log-date";
import { EmptyState } from "@/presentation/components/layout/empty-state";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import {
  loadConversationList,
  requireChatAdmin,
} from "@/presentation/guards/chat-admin-guard";
import { conversationsOn } from "@/presentation/presenters/conversation-dates";
import {
  formatLogDate,
  formatTokyoDateTime,
  getLogDateHref,
} from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

type ConversationDayPageProps = {
  params: Promise<{ year: string; month: string; day: string }>;
};

export default async function ConversationDayPage({
  params,
}: ConversationDayPageProps) {
  const user = await requireChatAdmin("/signin?callbackUrl=/conversations");
  const { year, month, day } = await params;
  const date = parseLogDate(year, month, day);
  if (!date) notFound();
  const conversations = await loadConversationList();
  if (!conversations) notFound();
  const items = conversationsOn(conversations, date);
  const dayHref = getLogDateHref(date, "/conversations");

  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={MessagesSquare}
        eyebrow="Conversation notes"
        title={formatLogDate(date)}
        description={`${items.length}件の会話`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/conversations">
              <ArrowLeft /> 日付の一覧へ
            </Link>
          </Button>
        }
      />
      {items.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="この日の会話はありません" />
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`${dayHref}/${item.number}`}
              className="group"
            >
              <Card className="transition-colors group-hover:bg-muted/40">
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      #{item.number} {item.title}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatTokyoDateTime(item.createdAt)}
                      {item.ended ? " · 上限に達した会話" : ""}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}
