import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { LogDate } from "../../domain/calendar/value-objects/log-date";
import {
  LEARNING_KINDS,
  type LearningEntry,
  type LearningHint,
  type LearningKind,
} from "../../domain/learning/entities/learning-entry";
import type { EntrySearch } from "../../domain/learning/entry-search";
import type {
  LogDateSummary,
  RecentLearningEntries,
  TrashedLearningEntries,
} from "../../domain/learning/learning-note-views";
import { jstDayRange, likeContains } from "./learning-sql";

// The trash page lists one page of notes.
const TRASH_LIST_LIMIT = 100;

// The most notes one export reads.
const EXPORT_LIMIT = 10_000;

type EntryRow = {
  id: string;
  kind: string;
  originalText: string;
  correctedText: string;
  pinyin: string;
  createdAt: Date;
  sharedAt: Date | null;
};

const ENTRY_COLUMNS = Prisma.sql`"id", "kind", "originalText", "correctedText", "pinyin", "createdAt", "sharedAt"`;

const entrySelect = {
  id: true,
  kind: true,
  originalText: true,
  correctedText: true,
  pinyin: true,
  createdAt: true,
  sharedAt: true,
} as const;

export function toKind(kind: string): LearningKind {
  if ((LEARNING_KINDS as readonly string[]).includes(kind)) {
    return kind as LearningKind;
  }
  throw new Error("invalid learning entry kind in the database");
}

// The search's conditions on the alias-less "LearningEntry", ANDed. The
// lowering is done by the database (its ctype decides non-ASCII letters) and
// LIKE over lower(...) lets the trigram indexes serve it. The query's ids
// come from a UNION, not an OR with an EXISTS, so the planner can combine
// those indexes.
function searchCondition(search: EntrySearch | undefined): Prisma.Sql {
  if (!search) return Prisma.empty;
  const conditions: Prisma.Sql[] = [];
  if (search.kind) conditions.push(Prisma.sql`"kind" = ${search.kind}`);
  if (search.query) {
    const p = likeContains(search.query);
    conditions.push(Prisma.sql`"id" IN (
      SELECT "id" FROM "LearningEntry"
       WHERE lower("originalText") LIKE lower(${p}) ESCAPE '\\'
          OR lower("correctedText") LIKE lower(${p}) ESCAPE '\\'
          OR lower("pinyin") LIKE lower(${p}) ESCAPE '\\'
      UNION
      SELECT "learningEntryId" FROM "Hint"
       WHERE lower("content") LIKE lower(${p}) ESCAPE '\\')`);
  }
  if (search.hint) {
    const p = likeContains(search.hint);
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "Hint" h
       WHERE h."learningEntryId" = "LearningEntry"."id"
         AND lower(h."content") LIKE lower(${p}) ESCAPE '\\')`);
  }
  if (conditions.length === 0) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.join(conditions, " AND ")}`;
}

// The hints of the given notes in one query, each note's by position; [] for
// a note without any.
export async function hintsByEntry(
  client: Pick<PrismaClient, "hint">,
  ids: string[],
): Promise<Map<string, LearningHint[]>> {
  const byEntry = new Map<string, LearningHint[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return byEntry;
  const hints = await client.hint.findMany({
    where: { learningEntryId: { in: ids } },
    select: { id: true, content: true, position: true, learningEntryId: true },
    orderBy: [{ learningEntryId: "asc" }, { position: "asc" }],
  });
  for (const { learningEntryId, id, content, position } of hints) {
    byEntry.get(learningEntryId)?.push({ id, content, position });
  }
  return byEntry;
}

// The owner's live (not trashed) notes among ids, with their hints, by id.
// Takes the client so a transaction can read them in its own snapshot.
export async function liveEntriesById(
  client: Pick<PrismaClient, "learningEntry" | "hint">,
  userId: string,
  ids: string[],
): Promise<Map<string, LearningEntry>> {
  if (ids.length === 0) return new Map();
  const rows = await client.learningEntry.findMany({
    where: { userId, id: { in: ids }, deletedAt: null },
    select: entrySelect,
  });
  const hints = await hintsByEntry(
    client,
    rows.map((row) => row.id),
  );
  return new Map(
    rows.map((row) => [
      row.id,
      toEntry({
        ...row,
        kind: toKind(row.kind),
        hints: hints.get(row.id) ?? [],
      }),
    ]),
  );
}

// Reads the owner's learning notes. Every list is ordered in SQL, so ties on
// time are broken by the database's id order.
export function createLearningNoteReads(db: () => PrismaClient) {
  // The hints of all rows in one query, each entry's by position; [] when an
  // entry has none.
  async function withHints<R extends EntryRow>(
    rows: R[],
  ): Promise<(Omit<R, "kind"> & Pick<LearningEntry, "kind" | "hints">)[]> {
    const byEntry = await hintsByEntry(
      db(),
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({
      ...row,
      kind: toKind(row.kind),
      hints: byEntry.get(row.id) ?? [],
    }));
  }

  async function toEntries(rows: EntryRow[]): Promise<LearningEntry[]> {
    return (await withHints(rows)).map(toEntry);
  }

  return {
    // The newest live notes, or with a search only those it matches; total
    // counts every live note the search matches. The count and the rows are
    // asked for together (the database may be far from the server); a note
    // added or trashed in between can leave total one off until the next
    // load.
    async listRecent(
      userId: string,
      limit: number,
      search?: EntrySearch,
    ): Promise<RecentLearningEntries> {
      const condition = searchCondition(search);
      const [[{ count }], entries] = await Promise.all([
        db().$queryRaw<[{ count: bigint }]>`
          SELECT count(*) AS count FROM "LearningEntry"
           WHERE "userId" = ${userId} AND "deletedAt" IS NULL ${condition}`,
        db().$queryRaw<EntryRow[]>`
          SELECT ${ENTRY_COLUMNS} FROM "LearningEntry"
           WHERE "userId" = ${userId} AND "deletedAt" IS NULL ${condition}
           ORDER BY "createdAt" DESC, "id" DESC
           LIMIT ${limit}`.then(toEntries),
      ]);
      return { entries, total: Number(count) };
    },

    // Every live note of the owner, newest first, up to the export's limit.
    async listAll(userId: string): Promise<LearningEntry[]> {
      const rows = await db().learningEntry.findMany({
        where: { userId, deletedAt: null },
        select: entrySelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: EXPORT_LIMIT,
      });
      return toEntries(rows);
    },

    // The Japan dates with live notes, newest first. The columns hold UTC
    // without a time zone, so 9 hours are added rather than AT TIME ZONE.
    async listLogDates(userId: string): Promise<LogDateSummary[]> {
      const rows = await db().$queryRaw<{ day: string; count: bigint }[]>`
        SELECT to_char(d, 'YYYY-MM-DD') AS day, count AS count
          FROM (
            SELECT ("createdAt" + interval '9 hours')::date AS d,
                   count(*) AS count
              FROM "LearningEntry"
             WHERE "userId" = ${userId} AND "deletedAt" IS NULL
             GROUP BY d
          ) AS days
         ORDER BY d DESC`;
      return rows.map(({ day, count }) => ({
        date: parseDay(day),
        count: Number(count),
      }));
    },

    // The live notes of a Japan date, oldest first.
    async listDailyEntries(
      userId: string,
      date: LogDate,
    ): Promise<LearningEntry[]> {
      const { start, end } = jstDayRange(date);
      const rows = await db().learningEntry.findMany({
        where: { userId, deletedAt: null, createdAt: { gte: start, lt: end } },
        select: entrySelect,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return toEntries(rows);
    },

    // The number-th (1-based) live note of a Japan date, oldest first, and
    // how many that date has; null when there is no such note. Counted
    // first: a note removed in between is not found.
    async getDailyEntry(
      userId: string,
      date: LogDate,
      number: number,
    ): Promise<{ entry: LearningEntry; number: number; total: number } | null> {
      if (!Number.isSafeInteger(number) || number < 1) return null;
      const { start, end } = jstDayRange(date);
      const [{ count }] = await db().$queryRaw<[{ count: bigint }]>`
        SELECT count(*) AS count FROM "LearningEntry"
         WHERE "userId" = ${userId} AND "deletedAt" IS NULL
           AND "createdAt" >= ${start} AND "createdAt" < ${end}`;
      const total = Number(count);
      if (number > total) return null;
      const rows = await db().$queryRaw<EntryRow[]>`
        SELECT ${ENTRY_COLUMNS} FROM "LearningEntry"
         WHERE "userId" = ${userId} AND "deletedAt" IS NULL
           AND "createdAt" >= ${start} AND "createdAt" < ${end}
         ORDER BY "createdAt" ASC, "id" ASC
         OFFSET ${number - 1} LIMIT 1`;
      const [entry] = await toEntries(rows);
      return entry ? { entry, number, total } : null;
    },

    // The newest of the owner's trash first, at most one page; total counts
    // the whole trash. The count is read first.
    async listTrashed(userId: string): Promise<TrashedLearningEntries> {
      const where = { userId, deletedAt: { not: null } };
      const total = await db().learningEntry.count({ where });
      const rows = await db().learningEntry.findMany({
        where,
        select: { ...entrySelect, deletedAt: true },
        orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
        take: TRASH_LIST_LIMIT,
      });
      const entries = await withHints(rows);
      return {
        entries: entries.map((row) => ({
          ...toEntry(row),
          // Selected only where it is set.
          deletedAt: row.deletedAt as Date,
        })),
        total,
      };
    },
  };
}

export type LearningNoteReads = ReturnType<typeof createLearningNoteReads>;

function toEntry(
  row: Omit<EntryRow, "kind"> & Pick<LearningEntry, "kind" | "hints">,
): LearningEntry {
  return {
    id: row.id,
    kind: row.kind,
    originalText: row.originalText,
    correctedText: row.correctedText,
    pinyin: row.pinyin,
    createdAt: row.createdAt,
    sharedAt: row.sharedAt,
    hints: row.hints,
  };
}

function parseDay(value: string): LogDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("invalid log date from the database");
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}
