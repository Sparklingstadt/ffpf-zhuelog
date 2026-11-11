import { MessageCircle, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { conversationNotes } from "@/composition/chat-container";
import type { ConversationSummary } from "@/domain/chat/conversation";
import { ChatUnavailableError } from "@/infrastructure/go-api/conversation-gateway";
import { AiRecentList } from "@/presentation/components/chat/ai-recent-list";
import { AiSideNav } from "@/presentation/components/chat/ai-side-nav";
import { ChatInterface } from "@/presentation/components/chat/chat-interface";
import { EmptyState } from "@/presentation/components/layout/empty-state";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { Button } from "@/presentation/components/ui/button";
import { requireChatUser } from "@/presentation/guards/chat-guard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type ChatPageProps = {
  searchParams: Promise<{ id?: string | string[] }>;
};

// How many recent conversations the left column lists.
const RECENT_COUNT = 8;

// Go answers 404 for the conversation list when OpenAI is not configured.
async function loadChat(): Promise<{
  chatModel: string;
  recent: ConversationSummary[];
} | null> {
  try {
    const list = await conversationNotes.list();
    return {
      chatModel: list.chatModel,
      recent: list.conversations.slice(0, RECENT_COUNT),
    };
  } catch (error) {
    if (error instanceof ChatUnavailableError) return null;
    throw error;
  }
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const user = await requireChatUser("/signin?callbackUrl=/chat");

  const { id } = await searchParams;
  if (id !== undefined && (typeof id !== "string" || !UUID.test(id)))
    notFound();
  const chat = await loadChat();
  const chatModel = chat?.chatModel ?? null;
  const initial = chatModel && id ? await conversationNotes.get(id) : null;
  if (chatModel && id && !initial) notFound();

  return (
    <PageShell user={user} width="6xl">
      <PageHeader
        title="ChatGPT と話す"
        description="ChatGPT と中国語で話し、表現・文法・語彙をその場で質問できます。話した内容は、回答ごとに会話ノートへ保存されます。"
        dense
        actions={
          // Wide screens list the conversations on the left instead.
          <Button asChild variant="outline" size="sm" className="lg:hidden">
            <Link href="/conversations">
              <MessagesSquare /> 会話ノート
            </Link>
          </Button>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <AiSideNav current="chat" showTabs={!user.demo} title="会話ノート">
          <AiRecentList
            items={(chat?.recent ?? []).map((c) => ({
              id: c.id,
              label: c.title,
              href: `/chat?id=${c.id}`,
              at: c.updatedAt,
            }))}
            currentId={initial?.id}
            empty="話すと、ここに残ります。"
            allHref="/conversations"
            allLabel="すべての会話ノート"
          />
        </AiSideNav>
        <div className="min-w-0">
          {chatModel ? (
            <ChatInterface
              key={initial?.id ?? "new"}
              chatModel={chatModel}
              initial={initial}
            />
          ) : (
            <EmptyState
              icon={MessageCircle}
              title="ChatGPT が設定されていません"
              description="Go API に OPENAI_API_KEY を設定すると、ここで会話できます。"
            />
          )}
        </div>
      </div>
    </PageShell>
  );
}
