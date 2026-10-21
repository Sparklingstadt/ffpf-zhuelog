// Creates the sample members and notes for trying the Go API locally.
// Run through `pnpm run api:db`; safe to run again (it skips what exists).
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { ScryptPasswordHasher } from "../src/infrastructure/auth/scrypt-password-hasher";

function required(name: string) {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set; source scripts/api-local-env.sh`);
  return value;
}

const connectionString = required("API_LOCAL_DATABASE_URL");
const url = new URL(connectionString);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
  throw new Error("api-local-seed only writes to a database on this machine.");
}

const members = [
  {
    loginId: required("API_LOCAL_DEMO_LOGIN"),
    password: required("API_LOCAL_DEMO_PASSWORD"),
    displayName: "デモ",
  },
  {
    loginId: required("API_LOCAL_FRIEND_LOGIN"),
    password: required("API_LOCAL_FRIEND_PASSWORD"),
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

  const friendOwner = `password:${ids[required("API_LOCAL_FRIEND_LOGIN")]}`;
  const already = await prisma.learningEntry.count({
    where: { ownerId: friendOwner },
  });
  if (already > 0) {
    console.log("kept friend's notes");
    return;
  }
  const now = new Date();
  await prisma.importBatch.create({
    data: {
      fileName: "api-local-seed",
      rowCount: friendNotes.length,
      entries: {
        create: friendNotes.map((note) => ({
          ownerId: friendOwner,
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
