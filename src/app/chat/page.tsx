import { ArrowLeft, MessageCircle, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { conversationNotes } from "@/composition/chat-container";
import { ChatUnavailableError } from "@/infrastructure/go-api/conversation-gateway";
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

// Go answers 404 for the conversation list when OpenAI is not configured.
async function loadChatModel(): Promise<string | null> {
  try {
    return (await conversationNotes.list()).chatModel;
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
  const chatModel = await loadChatModel();
  const initial = chatModel && id ? await conversationNotes.get(id) : null;
  if (chatModel && id && !initial) notFound();

  return (
    <PageShell user={user} width="5xl">
      <PageHeader
        icon={MessageCircle}
        eyebrow="ChatGPT"
        title="会話練習"
        description="ChatGPTと中国語を練習し、表現・文法・語彙についてその場で質問できます。会話は回答ごとに会話ノートへ保存されます。"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft /> 学習ノートへ
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/conversations">
                <MessagesSquare /> 会話ノート
              </Link>
            </Button>
          </>
        }
      />
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
    </PageShell>
  );
}
