import Link from "next/link";
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
import { AppHeader } from "@/presentation/components/layout/app-header";
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
    <>
      <AppHeader user={user} />
      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
          <header className="space-y-2 border-b pb-6">
            <Link
              href="/"
              className="text-sm text-muted-foreground hover:underline"
            >
              ← トップへ戻る
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight">
              アカウント管理
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              ID・パスワードでログインするアカウントを作成し、パスワードを再設定します。
            </p>
          </header>

          {actAsFailed ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              この会員として操作できませんでした。会員が存在するか、API
              が最新かを確認してください。
            </p>
          ) : null}

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

          <Card>
            <CardHeader>
              <CardTitle>アカウント一覧</CardTitle>
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
                      className="space-y-3 py-4 first:pt-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono text-sm font-medium break-all">
                          {account.loginId}
                        </span>
                        <span className="text-sm">{account.displayName}</span>
                        <span className="text-xs text-muted-foreground sm:ml-auto">
                          作成日 {dateFormat.format(account.createdAt)}
                        </span>
                      </div>
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
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
