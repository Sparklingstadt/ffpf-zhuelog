"use client";

import { Download } from "lucide-react";

import type { Conversation } from "@ffpf-zhuelog/core/domain/chat/conversation";
import { Button } from "@/presentation/components/ui/button";
import { downloadConversation } from "@/presentation/presenters/conversation-markdown";

export function ConversationDownloadButton({
  conversation,
}: {
  conversation: Conversation;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => downloadConversation(conversation)}
    >
      <Download />
      端末にダウンロード
    </Button>
  );
}
