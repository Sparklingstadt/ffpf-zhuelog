import { redirect } from "next/navigation";

import {
  getCurrentAdminUser,
  memberAccounts,
} from "@/composition/identity-container";
import { startActingAsAction } from "@/presentation/actions/acting-actions";
import { CreateAccountForm } from "@/presentation/components/auth/create-account-form";
import { ResetPasswordForm } from "@/presentation/components/auth/reset-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { Button } from "@/presentation/components/ui/button";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export default async function AdminAccountsPage({
  searchParams,
}: PageProps<"/admin/accounts">) {
  const user = await getCurrentAdminUser();
  if (!user) redirect("/");
  const actAsFailed = (await searchParams).actAs === "failed";

  const accounts = await memberAccounts.listAccounts();

  return (
    <PageShell user={user} width="6xl">
      <PageHeader
        title="アカウント管理"
        description="ID・パスワードでログインするアカウントを作成し、パスワードを再設定します。"
        dense
        actions={null}
      />

      {actAsFailed ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          この会員として操作できませんでした。会員が存在するか、API
          が最新かを確認してください。
        </p>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>アカウントを作成</CardTitle>
            <CardDescription>
              作成したパスワードは作成直後の1回だけ表示されます。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateAccountForm />
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>
              アカウント一覧{" "}
              <span className="text-sm font-normal text-muted-foreground">
                {accounts.length}件
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                まだアカウントはありません。
              </p>
            ) : (
              <ul className="divide-y">
                {accounts.map((account) => (
                  <li
                    key={account.id}
                    className="flex flex-wrap items-start gap-x-4 gap-y-3 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-48 flex-1">
                      <p className="font-mono text-sm font-medium break-all">
                        {account.loginId}
                      </p>
                      <p className="text-sm">{account.displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        作成日 {dateFormat.format(account.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-2">
                      <form
                        action={startActingAsAction.bind(null, account.ownerId)}
                      >
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          disabled={user.actingAs?.ownerId === account.ownerId}
                        >
                          {user.actingAs?.ownerId === account.ownerId
                            ? "この会員として操作中"
                            : "この会員として操作"}
                        </Button>
                      </form>
                      <ResetPasswordForm
                        accountId={account.id}
                        loginId={account.loginId}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
