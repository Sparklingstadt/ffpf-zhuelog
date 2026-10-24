import { ArrowLeft, MessageCircle, MessagesSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { conversationNotes } from "@/composition/chat-container";
import {
  parseLogDate,
  parseLogNumber,
} from "@/domain/calendar/value-objects/log-date";
import { deleteConversationAction } from "@/presentation/actions/conversation-actions";
import { ChatMessage } from "@/presentation/components/chat/chat-message";
import { ConversationExportButton } from "@/presentation/components/chat/conversation-export-button";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { NoteActionForm } from "@/presentation/components/records/note-action-form";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import {
  loadConversationList,
  requireChatAdmin,
} from "@/presentation/guards/chat-admin-guard";
import { conversationsOn } from "@/presentation/presenters/conversation-dates";
import {
  conversationMarkdownFileName,
  toConversationMarkdown,
} from "@/presentation/presenters/conversation-markdown-export";
import {
  formatLogDate,
  formatTokyoDateTime,
  getLogDateHref,
} from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

type ConversationDetailPageProps = {
  params: Promise<{ year: string; month: string; day: string; number: string }>;
};

export default async function ConversationDetailPage({
  params,
}: ConversationDetailPageProps) {
  const user = await requireChatAdmin("/signin?callbackUrl=/conversations");
  const { year, month, day, number } = await params;
  const date = parseLogDate(year, month, day);
  const conversationNumber = parseLogNumber(number);
  if (!date || !conversationNumber) notFound();
  const conversations = await loadConversationList();
  const summary = conversations
    ? conversationsOn(conversations, date).find(
        (item) => item.number === conversationNumber,
      )
    : undefined;
  const conversation = summary ? await conversationNotes.get(summary.id) : null;
  if (!conversation) notFound();

  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={MessagesSquare}
        eyebrow={`${formatLogDate(date)} · #${conversationNumber}`}
        title={conversation.title}
        description={`${formatTokyoDateTime(conversation.createdAt)} · ${conversation.modelName}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={getLogDateHref(date, "/conversations")}>
                <ArrowLeft /> この日の一覧へ
              </Link>
            </Button>
            {conversation.ended ? null : (
              <Button asChild size="sm">
                <Link href={`/chat?id=${conversation.id}`}>
                  <MessageCircle /> 続きを話す
                </Link>
              </Button>
            )}
            <ConversationExportButton
              markdown={toConversationMarkdown(conversation)}
              fileName={conversationMarkdownFileName(date, conversationNumber)}
            />
            <NoteActionForm
              action={deleteConversationAction}
              fields={{ id: conversation.id }}
              label="削除する"
              pendingLabel="削除中…"
              icon={<Trash2 />}
              confirmMessage="この会話を削除しますか？元に戻せません。"
            />
          </>
        }
      />
      <Card>
        <CardContent className="space-y-5">
          {conversation.messages.map((message) => (
            <ChatMessage
              key={message.id}
              role={message.role}
              text={message.text}
            />
          ))}
        </CardContent>
      </Card>
      {conversation.ended ? (
        <p className="text-sm text-muted-foreground">
          この会話は上限に達したため、続きは話せません。
        </p>
      ) : null}
    </PageShell>
  );
}
