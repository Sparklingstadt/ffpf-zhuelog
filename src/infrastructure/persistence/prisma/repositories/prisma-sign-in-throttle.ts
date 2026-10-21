import type { SignInThrottle } from "@/application/identity/ports/sign-in-throttle";
import { getPrismaClient } from "../prisma-client";

// The Go API (services/api/store/throttle.go) runs the same statements on the
// same table. The casts are needed because the driver sends Date parameters
// as text.
export class PrismaSignInThrottle implements SignInThrottle {
  async consume(key: string, limit: number, windowMs: number, now: Date) {
    const prisma = getPrismaClient();
    // SKIP LOCKED: concurrent sign-ins never wait on, or deadlock over, each
    // other's cleanup.
    await prisma.$executeRaw`
      DELETE FROM "SignInThrottle" WHERE "key" IN (
        SELECT "key" FROM "SignInThrottle"
        WHERE "expiresAt" <= CAST(${now} AS TIMESTAMP(3))
        LIMIT 100 FOR UPDATE SKIP LOCKED
      )
    `;
    // One statement, so concurrent attempts cannot read the same count.
    const expiresAt = new Date(now.getTime() + windowMs);
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "SignInThrottle" ("key", "count", "expiresAt")
      VALUES (${key}, 1, CAST(${expiresAt} AS TIMESTAMP(3)))
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "SignInThrottle"."expiresAt" <= CAST(${now} AS TIMESTAMP(3)) THEN 1 ELSE "SignInThrottle"."count" + 1 END,
        "expiresAt" = CASE WHEN "SignInThrottle"."expiresAt" <= CAST(${now} AS TIMESTAMP(3)) THEN CAST(${expiresAt} AS TIMESTAMP(3)) ELSE "SignInThrottle"."expiresAt" END
      RETURNING "count"
    `;
    return rows[0]!.count <= limit;
  }

  async reset(key: string) {
    await getPrismaClient().signInThrottle.deleteMany({ where: { key } });
  }
}
