import { ArrowLeft, UsersRound } from "lucide-react";
import Link from "next/link";

import { socialUseCases } from "@/composition/social-container";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { ReauthNotice } from "@/presentation/components/auth/reauth-notice";
import { FollowMemberList } from "@/presentation/components/follow/follow-member-list";
import { FollowTimeline } from "@/presentation/components/follow/follow-timeline";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { Button } from "@/presentation/components/ui/button";
import { requireNonGuestOwner } from "@/presentation/guards/record-owner-guard";

export const dynamic = "force-dynamic";

// Always the signed-in user's own follows: `?user=` is not read.
export default async function FollowPage() {
  const { user, owner } = await requireNonGuestOwner(
    undefined,
    "/signin?callbackUrl=/follow",
  );

  const viewerId = owner.kind === "self" ? owner.ownerId : null;
  const [directory, timeline] = viewerId
    ? await Promise.all([
        socialUseCases.listFollowDirectory.execute(viewerId),
        socialUseCases.listFollowTimeline.execute(viewerId),
      ])
    : [null, null];

  return (
    <PageShell width="5xl">
      <PageHeader
        icon={UsersRound}
        eyebrow="Follow"
        title="フォロー"
        description={
          directory
            ? `フォロー中 ${directory.followingCount}人・フォロワー ${directory.followerCount}人`
            : null
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft /> ホームへ
              </Link>
            </Button>
            <AuthControls user={user} />
          </>
        }
      />

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
    </PageShell>
  );
}
