import type { FollowTimelineItem } from "@ffpf-zhuelog/core/application/social/use-cases/list-follow-timeline";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";

export function FollowTimeline({ items }: { items: FollowTimelineItem[] }) {
  if (items.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        共有されたノートはまだありません。
      </p>
    );

  return (
    <div className="grid gap-4">
      {items.map(({ entry, ownerName }) => (
        // No link: the detail page is only for the note's owner and admins.
        <div key={entry.id} className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {ownerName}さん・
            <time dateTime={entry.createdAt.toISOString()}>
              {formatTokyoDateTime(entry.createdAt)}
            </time>
          </p>
          <LearningEntryCard entry={entry} numberLabel="" />
        </div>
      ))}
    </div>
  );
}
