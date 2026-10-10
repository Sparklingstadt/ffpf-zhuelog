import { ArrowLeft, UsersRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getRecordOwner } from "@/composition/identity-container";
import { socialUseCases } from "@/composition/social-container";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { ReauthNotice } from "@/presentation/components/chat/reauth-notice";
import { FollowMemberList } from "@/presentation/components/follow/follow-member-list";
import { FollowTimeline } from "@/presentation/components/follow/follow-timeline";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";

export const dynamic = "force-dynamic";

// Always the signed-in user's own follows: `?user=` is not read.
export default async function FollowPage() {
  const { user, owner } = await getRecordOwner(undefined);
  if (!user || (owner.kind === "denied" && owner.reason === "unauthenticated"))
    redirect("/signin?callbackUrl=/follow");
  if (owner.kind === "denied" && owner.reason === "guest") redirect("/");

  const viewerId = owner.kind === "self" ? owner.ownerId : null;
  const [directory, timeline] = viewerId
    ? await Promise.all([
        socialUseCases.listFollowDirectory.execute(viewerId),
        socialUseCases.listFollowTimeline.execute(viewerId),
      ])
    : [null, null];

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="gap-1.5">
              <UsersRound className="size-3.5" /> Follow
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                フォロー
              </h1>
              {directory ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  フォロー中 {directory.followingCount}人・フォロワー{" "}
                  {directory.followerCount}人
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft /> ホームへ
              </Link>
            </Button>
            <AuthControls user={user} />
          </div>
        </header>

        {!directory || !timeline ? (
          <ReauthNotice subject="フォロー" />
        ) : (
          <>
            <section className="space-y-3">
              <h2 className="text-xl font-semibold tracking-tight">メンバー</h2>
              <FollowMemberList members={directory.members} />
            </section>
            <section className="space-y-3">
              <h2 className="text-xl font-semibold tracking-tight">
                フォロー中の人の共有ノート
              </h2>
              <FollowTimeline items={timeline} />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
