import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentMemberUser } from "@/composition/identity-container";
import { ChangePasswordForm } from "@/presentation/components/auth/change-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await getCurrentMemberUser();
  if (user?.role !== "member" || !user.accountId) redirect("/");

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
        <header className="space-y-2 border-b pb-6">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← トップへ戻る
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">
            パスワードを変更
          </h1>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>新しいパスワードを設定</CardTitle>
            <CardDescription>
              変更するとログアウトされます。新しいパスワードでもう一度ログインしてください。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
