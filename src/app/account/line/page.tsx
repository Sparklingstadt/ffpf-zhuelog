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
import { LineReviewNotifyForm } from "@/presentation/components/account/line-review-notify-form";
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
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
          <header className="space-y-2 border-b pb-6">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                LINE 連携
              </h1>
              {link.available ? (
                <span
                  className={
                    link.linked
                      ? "rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                      : "rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                  }
                >
                  {link.linked ? "連携中です" : "まだ連携していません"}
                </span>
              ) : null}
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              LINE
              で中国語の文を送ると添削が、日本語の文を送ると中国語訳が返ってきて、学習ノートに保存されます。
            </p>
          </header>

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

          {link.available && link.linked ? (
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle>復習のお知らせ</CardTitle>
                <CardDescription>
                  「今日の復習」に答える問題がある朝（6 時ごろ）に、この LINE へ
                  1 日 1 回お知らせします。問題が無い日は送りません。LINE
                  公式アカウントの月の送信数に上限があるため、上限が近い月は届かないことがあります。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LineReviewNotifyForm on={link.reviewNotify} />
              </CardContent>
            </Card>
          ) : null}

          {link.available ? (
            <p className="max-w-2xl text-xs leading-6 text-muted-foreground">
              LINE で送った文は、添削や翻訳を作るために
              OpenAI（ChatGPT）に送られます。送りたくない文は LINE
              に送らないでください。
            </p>
          ) : null}
        </div>
      </main>
    </>
  );
}
