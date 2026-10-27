import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentMemberUser } from "@/composition/identity-container";
import { FFPF_OWNER_PREFIX } from "@/domain/identity/owner-id";
import { ffpfIdConfig } from "@/infrastructure/config/environment";
import { ChangePasswordForm } from "@/presentation/components/auth/change-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";
import { AppHeader } from "@/presentation/components/layout/app-header";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await getCurrentMemberUser();
  if (user?.role !== "member") redirect("/");
  // FFPF ID members have no password account here (no accountId); their
  // password lives in the portal.
  const isFfpfMember = Boolean(user.githubId?.startsWith(FFPF_OWNER_PREFIX));
  if (!isFfpfMember && !user.accountId) redirect("/");
  const ffpfIssuer = ffpfIdConfig()?.issuer;

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
            <h1 className="text-3xl font-semibold tracking-tight">
              パスワードを変更
            </h1>
          </header>

          {isFfpfMember ? (
            <Card>
              <CardHeader>
                <CardTitle>FFPF IDでログインしています</CardTitle>
                <CardDescription>
                  パスワードは FFPF ID のマイページで変更できます
                </CardDescription>
              </CardHeader>
              {ffpfIssuer ? (
                <CardContent>
                  <a
                    href={`${ffpfIssuer}/id`}
                    className="text-sm font-medium underline underline-offset-4"
                  >
                    FFPF ID のマイページを開く
                  </a>
                </CardContent>
              ) : null}
            </Card>
          ) : (
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
          )}
        </div>
      </main>
    </>
  );
}
