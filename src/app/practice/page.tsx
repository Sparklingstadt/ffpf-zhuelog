import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentViewerUser } from "@/composition/identity-container";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { PracticeInterface } from "@/presentation/components/practice/practice-interface";
import { Button } from "@/presentation/components/ui/button";

export const dynamic = "force-dynamic";

export default async function PracticePage() {
  const user = await getCurrentViewerUser();
  if (!user) redirect("/signin?callbackUrl=/practice");
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl min-w-0 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <div>
          <h1 className="text-2xl font-semibold">自分のAPIキーで添削</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            共有ノートとは別の、端末に保存する個人練習です。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/">学習ノートへ</Link>
          </Button>
          <AuthControls user={user} />
        </div>
      </header>
      <PracticeInterface />
    </main>
  );
}
