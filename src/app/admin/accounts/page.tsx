import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getCurrentAdminUser,
  passwordAccountUseCases,
} from "@/composition/identity-container";
import { CreateAccountForm } from "@/presentation/components/auth/create-account-form";
import { ResetPasswordForm } from "@/presentation/components/auth/reset-password-form";
import { Badge } from "@/presentation/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export default async function AdminAccountsPage() {
  if (!(await getCurrentAdminUser())) redirect("/");

  const accounts = await passwordAccountUseCases.list.execute();

  return (
    <main className="min-h-screen bg-background">
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
                      {account.locked ? (
                        <Badge variant="destructive">ロック中</Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground sm:ml-auto">
                        作成日 {dateFormat.format(account.createdAt)}
                      </span>
                    </div>
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
  );
}
