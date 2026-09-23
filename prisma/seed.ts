import { readFile } from "node:fs/promises";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client";
import { securePostgresConnectionString } from "../src/infrastructure/config/postgres-connection";

type SeedEntry = {
  id: string;
  createdAt: string;
  originalText: string;
  correctedText: string;
  pinyin: string;
  hints: string[];
};

type SeedBatch = {
  id: string;
  fileName: string;
  importedAt: string;
  entries: SeedEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field}は空でない文字列で指定してください。`);
  }
  return value;
}

function requiredDate(value: unknown, field: string) {
  const date = requiredString(value, field);
  if (Number.isNaN(Date.parse(date)))
    throw new Error(`${field}はISO 8601形式で指定してください。`);
  return date;
}

function parseSeed(source: string): { batches: SeedBatch[] } {
  const raw = JSON.parse(source) as unknown;
  if (!isRecord(raw) || !Array.isArray(raw.batches)) {
    throw new Error("seedファイルにはbatches配列が必要です。");
  }

  return {
    batches: raw.batches.map((batch, batchIndex) => {
      if (
        !isRecord(batch) ||
        !Array.isArray(batch.entries) ||
        batch.entries.length === 0
      ) {
        throw new Error(
          `batches[${batchIndex}]には1件以上のentriesが必要です。`,
        );
      }
      const fileName = requiredString(
        batch.fileName,
        `batches[${batchIndex}].fileName`,
      );
      if (fileName.length > 255)
        throw new Error(`batches[${batchIndex}].fileNameは255文字以内です。`);

      return {
        id: requiredString(batch.id, `batches[${batchIndex}].id`),
        fileName,
        importedAt: requiredDate(
          batch.importedAt,
          `batches[${batchIndex}].importedAt`,
        ),
        entries: batch.entries.map((entry, entryIndex) => {
          if (!isRecord(entry) || !Array.isArray(entry.hints)) {
            throw new Error(
              `batches[${batchIndex}].entries[${entryIndex}]が不正です。`,
            );
          }
          return {
            id: requiredString(entry.id, `entries[${entryIndex}].id`),
            createdAt: requiredDate(
              entry.createdAt,
              `entries[${entryIndex}].createdAt`,
            ),
            originalText: requiredString(
              entry.originalText,
              `entries[${entryIndex}].originalText`,
            ),
            correctedText: requiredString(
              entry.correctedText,
              `entries[${entryIndex}].correctedText`,
            ),
            pinyin: requiredString(
              entry.pinyin,
              `entries[${entryIndex}].pinyin`,
            ),
            hints: entry.hints.map((hint, hintIndex) =>
              requiredString(
                hint,
                `entries[${entryIndex}].hints[${hintIndex}]`,
              ),
            ),
          };
        }),
      };
    }),
  };
}

const rawConnectionString =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!rawConnectionString) {
  throw new Error(
    "DATABASE_URLまたはDATABASE_URL_UNPOOLEDを設定してください。",
  );
}

const connectionString = securePostgresConnectionString(rawConnectionString);

const seedFile = path.resolve(
  process.cwd(),
  process.env.PRISMA_SEED_FILE ?? "prisma/seed.private.json",
);
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const source = await readFile(seedFile, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        throw new Error(
          `seedファイルが見つかりません: ${seedFile}\n` +
            "prisma/seed.example.jsonを参考に、Git管理外のprisma/seed.private.jsonを作成してください。",
        );
      }
      throw error;
    },
  );
  const seed = parseSeed(source);
  console.info(`Seed source: ${seed.batches.length}バッチを検証しました。`);

  let created = 0;
  let skipped = 0;

  await prisma.$transaction(
    async (tx) => {
      for (const batch of seed.batches) {
        const missingEntries = [];

        for (const entry of batch.entries) {
          const existing =
            (await tx.learningEntry.findUnique({
              where: { id: entry.id },
              select: { id: true },
            })) ??
            (await tx.learningEntry.findFirst({
              where: {
                originalText: entry.originalText,
                correctedText: entry.correctedText,
                pinyin: entry.pinyin,
              },
              select: { id: true },
            }));

          if (existing) {
            skipped += 1;
          } else {
            missingEntries.push(entry);
          }
        }

        if (missingEntries.length === 0) continue;

        await tx.importBatch.upsert({
          where: { id: batch.id },
          update: {},
          create: {
            id: batch.id,
            fileName: batch.fileName,
            rowCount: batch.entries.length,
            importedAt: new Date(batch.importedAt),
          },
        });

        for (const entry of missingEntries) {
          await tx.learningEntry.create({
            data: {
              id: entry.id,
              batchId: batch.id,
              createdAt: new Date(entry.createdAt),
              originalText: entry.originalText,
              correctedText: entry.correctedText,
              pinyin: entry.pinyin,
              hints: {
                create: entry.hints.map((content, position) => ({
                  id: `${entry.id}-hint-${position + 1}`,
                  content,
                  position,
                })),
              },
            },
          });
          created += 1;
        }
      }
    },
    { maxWait: 30_000, timeout: 30_000 },
  );

  console.info(
    `Seed complete: ${created}件を追加、${skipped}件をスキップしました。`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
