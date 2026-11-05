import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getCurrentViewerUser,
  memberAccounts,
} from "@/composition/identity-container";
import {
  isLineLinkPreview,
  lineAddFriendUrl,
  lineOfficialAccountId,
} from "@/infrastructure/config/environment";
import { LineLinkPanel } from "@/presentation/components/account/line-link-panel";
import { AppHeader } from "@/presentation/components/layout/app-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";

export const dynamic = "force-dynamic";

export default async function LineLinkPage() {
  const user = await getCurrentViewerUser();
  // The viewer guard lets guests through; they have no LINE link.
  if (!user || user.role === "guest") redirect("/");

  const link = await memberAccounts.getLineLink();

  return (
    <>
      <AppHeader user={user} />
      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
          <header className="space-y-2 border-b pb-6">
            <Link
              href="/"
              className="text-sm text-muted-foreground hover:underline"
            >
              ← トップへ戻る
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight">LINE 連携</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              LINE
              で中国語の文を送ると添削が、日本語の文を送ると中国語訳が返ってきて、学習ノートに保存されます。
            </p>
          </header>

          <Card>
            <CardHeader>
              <CardTitle>
                {link.available
                  ? link.linked
                    ? "連携中です"
                    : "LINE と連携する"
                  : "LINE 連携"}
              </CardTitle>
              <CardDescription>
                {link.available
                  ? "LINE で送った文は、添削や翻訳を作るために OpenAI（ChatGPT）に送られます。送りたくない文は LINE に送らないでください。"
                  : null}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {link.available ? (
                <LineLinkPanel
                  key={link.linked ? "linked" : "unlinked"}
                  linked={link.linked}
                  addFriendUrl={lineAddFriendUrl()}
                  officialAccountId={lineOfficialAccountId()}
                  preview={isLineLinkPreview()}
                />
              ) : (
                <p className="text-sm">LINE 連携は今は使えません。</p>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
