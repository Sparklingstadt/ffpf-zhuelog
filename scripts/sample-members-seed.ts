// Puts the sample members and the friend's shared notes into the local
// database for trying the web (docs/development.md). Run through
// `pnpm run db:seed:sample`; safe to run again (it skips what exists).
// Local test values only.
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client";
import { ScryptPasswordHasher } from "../src/infrastructure/security/scrypt-password-hasher";
import { securePostgresConnectionString } from "../prisma/postgres-connection";

const rawConnectionString = process.env.DATABASE_URL;
if (!rawConnectionString) throw new Error("DATABASE_URL is not set.");
const url = new URL(rawConnectionString);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
  throw new Error(
    "sample-members-seed only writes to a database on this machine.",
  );
}
const connectionString = securePostgresConnectionString(rawConnectionString);

const members = [
  { loginId: "demo", password: "demo-password-123", displayName: "デモ" },
  {
    loginId: "friend",
    password: "friend-password-123",
    displayName: "フレンド",
  },
];

// Shared notes owned by the friend, so the demo user has a timeline to read.
const friendNotes = [
  {
    originalText: "我昨天去了图书馆看书。",
    correctedText: "我昨天去图书馆看书了。",
    pinyin: "wǒ zuótiān qù túshūguǎn kàn shū le",
    hints: ["「了」は文末に置くと、出来事の完了を表します。"],
  },
  {
    originalText: "这个菜很好吃的。",
    correctedText: "这个菜很好吃。",
    pinyin: "zhège cài hěn hǎochī",
    hints: ["「很」で十分なので「的」は不要です。"],
  },
];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const hasher = new ScryptPasswordHasher();

async function main() {
  const ids: Record<string, string> = {};
  for (const member of members) {
    const existing = await prisma.passwordAccount.findUnique({
      where: { loginId: member.loginId },
    });
    const account =
      existing ??
      (await prisma.passwordAccount.create({
        data: {
          loginId: member.loginId,
          displayName: member.displayName,
          passwordHash: await hasher.hash(member.password),
        },
      }));
    ids[member.loginId] = account.id;
    console.log(`${existing ? "kept" : "created"} member ${member.loginId}`);
  }

  const friendOwner = ids["friend"];
  const already = await prisma.learningEntry.count({
    where: { userId: friendOwner },
  });
  if (already > 0) {
    console.log("kept friend's notes");
    return;
  }
  const now = new Date();
  await prisma.importBatch.create({
    data: {
      fileName: "sample-members-seed",
      rowCount: friendNotes.length,
      entries: {
        create: friendNotes.map((note) => ({
          userId: friendOwner,
          originalText: note.originalText,
          correctedText: note.correctedText,
          pinyin: note.pinyin,
          sharedAt: now,
          hints: {
            create: note.hints.map((content, position) => ({
              content,
              position,
            })),
          },
        })),
      },
    },
  });
  console.log(`created ${friendNotes.length} shared notes for friend`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
