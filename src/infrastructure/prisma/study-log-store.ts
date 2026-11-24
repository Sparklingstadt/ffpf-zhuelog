import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { StudyDay } from "../../domain/study-log/study-log";

// The study log is one raw query: five tables joined by UNION ALL and summed
// by Japan day. Prisma's query API cannot group several tables by a computed
// day in one round trip. The columns are TIMESTAMP(3) without a time zone
// holding UTC, so a Japan day is the column plus 9 hours, cast to a date (as
// reviewedDates does), never AT TIME ZONE. The day comes back as "YYYY-MM-DD"
// text so it never passes through a JS Date.

// Pure: the owner's days with anything in [start, end), oldest first, with
// reviews (answers), practice questions (the sum of questionCount), notes not
// in the trash and words, each by its Japan day.
export function studyLogSql(
  ownerId: string,
  start: Date,
  end: Date,
): Prisma.Sql {
  return Prisma.sql`SELECT to_char("day", 'YYYY-MM-DD') AS "date",
    sum("reviews") AS "reviews", sum("practice") AS "practiceQuestions",
    sum("notes") AS "notes", sum("words") AS "words"
  FROM (
    SELECT ("reviewedAt" + interval '9 hours')::date AS "day", 1 AS "reviews", 0 AS "practice", 0 AS "notes", 0 AS "words"
      FROM "ReviewLog" WHERE "ownerId" = ${ownerId} AND "reviewedAt" >= ${start} AND "reviewedAt" < ${end}
    UNION ALL
    SELECT ("createdAt" + interval '9 hours')::date, 0, "questionCount", 0, 0
      FROM "PrepositionPracticeRecord" WHERE "ownerId" = ${ownerId} AND "createdAt" >= ${start} AND "createdAt" < ${end}
    UNION ALL
    SELECT ("createdAt" + interval '9 hours')::date, 0, "questionCount", 0, 0
      FROM "ComplementPracticeRecord" WHERE "ownerId" = ${ownerId} AND "createdAt" >= ${start} AND "createdAt" < ${end}
    UNION ALL
    SELECT ("createdAt" + interval '9 hours')::date, 0, 0, 1, 0
      FROM "LearningEntry" WHERE "ownerId" = ${ownerId} AND "deletedAt" IS NULL AND "createdAt" >= ${start} AND "createdAt" < ${end}
    UNION ALL
    SELECT ("createdAt" + interval '9 hours')::date, 0, 0, 0, 1
      FROM "VocabularyEntry" WHERE "ownerId" = ${ownerId} AND "createdAt" >= ${start} AND "createdAt" < ${end}
  ) AS "activity"
  GROUP BY "day"
  ORDER BY "day"`;
}

// Postgres sums come back as bigint.
export type StudyDayRow = {
  date: string;
  reviews: bigint;
  practiceQuestions: bigint;
  notes: bigint;
  words: bigint;
};

// Pure: a row as the domain's StudyDay.
export function studyDayFromRow(row: StudyDayRow): StudyDay {
  return {
    date: row.date,
    reviews: Number(row.reviews),
    practiceQuestions: Number(row.practiceQuestions),
    notes: Number(row.notes),
    words: Number(row.words),
  };
}

export function createStudyLogStore(db: () => PrismaClient) {
  return {
    // The owner's days with anything in [start, end), oldest first.
    async days(ownerId: string, start: Date, end: Date): Promise<StudyDay[]> {
      const rows = await db().$queryRaw<StudyDayRow[]>(
        studyLogSql(ownerId, start, end),
      );
      return rows.map(studyDayFromRow);
    },
  };
}
