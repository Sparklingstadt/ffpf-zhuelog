"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/presentation/components/ui/alert";
import { Button } from "@/presentation/components/ui/button";
import { AppHeader } from "@/presentation/components/layout/app-header";

export default function SignInError({ retry }: { retry: () => void }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-10">
        <div className="w-full space-y-4">
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>ログインできませんでした</AlertTitle>
            <AlertDescription>
              ログイン処理でエラーが発生しました。時間をおいてもう一度お試しください。
            </AlertDescription>
          </Alert>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" onClick={() => retry()}>
              もう一度試す
            </Button>
            <Button asChild variant="outline">
              <Link href="/signin">ログイン画面へ戻る</Link>
            </Button>
          </div>
        </div>
      </main>
    </>
  );
}
