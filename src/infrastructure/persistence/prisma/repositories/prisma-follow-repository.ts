import type { FollowRepository } from "@ffpf-zhuelog/core/domain/social/repositories/follow-repository";
import { getPrismaClient } from "../prisma-client";

export class PrismaFollowRepository implements FollowRepository {
  async follow(followerId: string, followeeId: string): Promise<void> {
    await getPrismaClient().follow.createMany({
      data: [{ followerId, followeeId }],
      skipDuplicates: true,
    });
  }

  async unfollow(followerId: string, followeeId: string): Promise<boolean> {
    const { count } = await getPrismaClient().follow.deleteMany({
      where: { followerId, followeeId },
    });
    return count === 1;
  }

  async listFollowing(followerId: string): Promise<string[]> {
    const rows = await getPrismaClient().follow.findMany({
      where: { followerId },
      select: { followeeId: true },
    });
    return rows.map((row) => row.followeeId);
  }

  async listFollowers(followeeId: string): Promise<string[]> {
    const rows = await getPrismaClient().follow.findMany({
      where: { followeeId },
      select: { followerId: true },
    });
    return rows.map((row) => row.followerId);
  }
}
