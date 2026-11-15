import { socialNetwork } from "@/composition/social-container";
import { ReauthNotice } from "@/presentation/components/auth/reauth-notice";
import { FollowMemberList } from "@/presentation/components/follow/follow-member-list";
import { FollowTimeline } from "@/presentation/components/follow/follow-timeline";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { requireNonGuestOwner } from "@/presentation/guards/record-owner-guard";

export const dynamic = "force-dynamic";

// Always the signed-in user's own follows: `?user=` is not read.
export default async function FollowPage() {
  const { user, owner } = await requireNonGuestOwner(
    undefined,
    "/signin?callbackUrl=/follow",
  );

  // Go reads the follows of the token's owner.
  const [directory, timeline] =
    owner.kind === "self"
      ? await Promise.all([
          socialNetwork.listMembers(),
          socialNetwork.listTimeline(),
        ])
      : [null, null];

  return (
    <PageShell user={user} width="6xl">
      <PageHeader
        title="フォロー"
        description={
          directory
            ? `フォロー中 ${directory.followingCount}人・フォロワー ${directory.followerCount}人`
            : null
        }
        dense
        actions={null}
      />

      {!directory || !timeline ? (
        <ReauthNotice subject="フォロー" />
      ) : (
        // The shared notes are the page's subject; the members to follow
        // sit beside them on wide screens and below them on phones.
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="min-w-0 space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">
              フォロー中の人の共有ノート
            </h2>
            <FollowTimeline items={timeline} />
          </section>
          <section className="space-y-3 rounded-xl border bg-card p-5">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">メンバー</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                フォローすると、その人が共有したノートが並びます。
              </p>
            </div>
            <FollowMemberList members={directory.members} />
          </section>
        </div>
      )}
    </PageShell>
  );
}
