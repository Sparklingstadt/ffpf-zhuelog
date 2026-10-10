import { UserMinus, UserPlus } from "lucide-react";

import type { FollowDirectoryMember } from "@ffpf-zhuelog/core/application/social/use-cases/list-follow-directory";
import {
  followMemberAction,
  unfollowMemberAction,
} from "@/presentation/actions/follow-actions";
import { NoteActionForm } from "@/presentation/components/records/note-action-form";
import { Badge } from "@/presentation/components/ui/badge";

export function FollowMemberList({
  members,
}: {
  members: FollowDirectoryMember[];
}) {
  if (members.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        ほかのメンバーはいません。
      </p>
    );

  return (
    <ul className="divide-y rounded-lg border">
      {members.map((member) => (
        <li
          key={member.ownerId}
          aria-label={member.displayName}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="break-all font-medium">
              {member.displayName}（{member.loginId}）
            </span>
            {member.followsMe ? (
              <Badge variant="secondary">フォローされています</Badge>
            ) : null}
          </div>
          {member.following ? (
            <NoteActionForm
              action={unfollowMemberAction}
              fields={{ followeeId: member.ownerId }}
              label="フォロー解除"
              pendingLabel="処理中…"
              icon={<UserMinus />}
              variant="outline"
            />
          ) : (
            <NoteActionForm
              action={followMemberAction}
              fields={{ followeeId: member.ownerId }}
              label="フォローする"
              pendingLabel="処理中…"
              icon={<UserPlus />}
              variant="default"
            />
          )}
        </li>
      ))}
    </ul>
  );
}
