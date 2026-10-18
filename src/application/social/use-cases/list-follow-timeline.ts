import { ownerIdForAccount } from "../../../domain/identity/entities/password-account";
import type { PasswordAccountRepository } from "../../../domain/identity/repositories/password-account-repository";
import type {
  LearningEntryRepository,
  SharedLearningEntry,
} from "../../../domain/learning/repositories/learning-entry-repository";
import type { FollowRepository } from "../../../domain/social/repositories/follow-repository";

export const FOLLOW_TIMELINE_LIMIT = 100;

export type FollowTimelineItem = {
  entry: SharedLearningEntry;
  ownerName: string;
};

export class ListFollowTimeline {
  constructor(
    private readonly follows: FollowRepository,
    private readonly accounts: PasswordAccountRepository,
    private readonly entries: LearningEntryRepository,
  ) {}

  async execute(
    viewerId: string,
    limit = FOLLOW_TIMELINE_LIMIT,
  ): Promise<FollowTimelineItem[]> {
    const following = await this.follows.listFollowing(viewerId);
    if (following.length === 0) return [];
    const [entries, accounts] = await Promise.all([
      this.entries.listSharedByOwners(following, limit),
      this.accounts.list(),
    ]);
    const names = new Map(
      accounts.map((account) => [
        ownerIdForAccount(account.id),
        account.displayName,
      ]),
    );
    return entries.flatMap((entry) => {
      const ownerName = names.get(entry.ownerId);
      return ownerName === undefined ? [] : [{ entry, ownerName }];
    });
  }
}
