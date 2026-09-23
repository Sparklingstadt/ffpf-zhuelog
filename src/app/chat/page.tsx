import { ArrowLeft, Languages, MessageCircle } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentAdminUser } from "@/composition/identity-container";
import {
  isOpenAiConfigured,
  getOpenAiModelName,
} from "@/infrastructure/config/environment";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { ChatInterface } from "@/presentation/components/chat/chat-interface";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await getCurrentAdminUser();
  if (!user) redirect("/signin?callbackUrl=/chat");

  const configured = isOpenAiConfigured();
  const modelName = getOpenAiModelName();

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1.5">
                <Languages className="size-3.5" /> Chinese learning log
              </Badge>
              <Badge variant="outline" className="gap-1.5">
                <MessageCircle className="size-3.5" /> ChatGPT
              </Badge>
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                会話練習
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                ChatGPTと中国語を練習し、表現・文法・語彙についてその場で質問できます。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft /> 学習ノートへ
              </Link>
            </Button>
            <AuthControls user={user} />
          </div>
        </header>

        <ChatInterface configured={configured} modelName={modelName} />
      </div>
    </main>
  );
}
