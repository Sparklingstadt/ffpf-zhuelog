import { FollowMember } from "@ffpf-zhuelog/core/application/social/use-cases/follow-member";
import { ListFollowDirectory } from "@ffpf-zhuelog/core/application/social/use-cases/list-follow-directory";
import { ListFollowTimeline } from "@ffpf-zhuelog/core/application/social/use-cases/list-follow-timeline";
import { UnfollowMember } from "@ffpf-zhuelog/core/application/social/use-cases/unfollow-member";
import { passwordAccountRepository } from "@/infrastructure/auth/password-account-services";
import { PrismaFollowRepository } from "@/infrastructure/persistence/prisma/repositories/prisma-follow-repository";
import { PrismaLearningEntryRepository } from "@/infrastructure/persistence/prisma/repositories/prisma-learning-entry-repository";

const follows = new PrismaFollowRepository();
const entries = new PrismaLearningEntryRepository();

export const socialUseCases = {
  followMember: new FollowMember(follows, passwordAccountRepository),
  unfollowMember: new UnfollowMember(follows),
  listFollowDirectory: new ListFollowDirectory(
    follows,
    passwordAccountRepository,
  ),
  listFollowTimeline: new ListFollowTimeline(
    follows,
    passwordAccountRepository,
    entries,
  ),
};
