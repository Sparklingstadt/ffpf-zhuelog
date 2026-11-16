// The demo account's data, built from the fixture (demo-fixture.json, a copy
// of Go's services/api/demo/seed.json) with its dates made relative to the
// reset, as Go's demo package builds it (services/api/demo/demo.go). The
// golden file Go writes (tests/fixtures/demo-seed-golden.json) holds both to
// the same seed.

import { type FsrsCard, newFsrsCard, nextFsrsCard } from "../review/fsrs";

// The fixture cannot be read or does not make a seed.
export class DemoFixtureError extends Error {
  override name = "DemoFixtureError";
}

export type DemoCardHistory = {
  card: FsrsCard;
  // Each answer with the card as it stood just before (what ReviewLog keeps).
  answers: { rating: number; at: Date; before: FsrsCard }[];
};

export type DemoNote = {
  kind: "correction" | "translation";
  originalText: string;
  correctedText: string;
  pinyin: string;
  hints: string[];
  createdAt: Date;
  review: DemoCardHistory | null;
};

export type DemoWord = {
  id: string;
  word: string;
  pinyin: string;
  meaning: string;
  sourceNote: number; // index in DemoSeed.notes
  createdAt: Date;
  review: DemoCardHistory;
};

export type DemoConversation = {
  id: string;
  title: string;
  modelName: string;
  ended: true;
  createdAt: Date;
  updatedAt: Date;
  messages: { id: string; role: "user" | "assistant"; text: string }[];
};

export type DemoRound = {
  id: string;
  elapsedMs: number;
  startedAt: Date;
  createdAt: Date;
  questionCount: number;
  firstTryCount: number;
  missCount: number;
  questions: {
    id: string;
    answer: string;
    noun: string;
    prompt: string;
    misses: string[];
  }[];
};

export type DemoSeed = {
  displayName: string;
  notes: DemoNote[];
  words: DemoWord[];
  conversations: DemoConversation[];
  prepositionRecords: DemoRound[];
  complementRecords: (DemoRound & { mode: string })[];
};

// Go: wordDelay (demo.go:118). How long after its note a word is picked.
export const DEMO_WORD_DELAY_MS = 300_000;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
// Japan has no summer time: JST is always UTC+9.
const JST_OFFSET_HOURS = 9;
// demo.go:262 and :265: "today" is due an hour ago; "later" is two days on.
const DUE_TODAY_MS = HOUR_MS;
const DUE_LATER_MS = 48 * HOUR_MS;

// Go: builder.at (demo.go:218-230). The JST date `day` days before now's JST
// date, at time (HH:MM, JST); a moment after now becomes a minute before now.
// null when day is negative or not an integer, or time is not HH:MM.
export function demoFixtureTime(
  now: Date,
  day: number,
  time: string,
): Date | null {
  if (!Number.isInteger(day) || day < 0) return null;
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!clock) return null;
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour > 23 || minute > 59) return null;
  const today = new Date(now.getTime() + JST_OFFSET_HOURS * HOUR_MS);
  const at = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - day,
      hour - JST_OFFSET_HOURS,
      minute,
    ),
  );
  if (at.getTime() > now.getTime()) {
    return new Date(now.getTime() - MINUTE_MS);
  }
  return at;
}

// Reading the fixture. Go decodes it with json.DisallowUnknownFields
// (demo.go:122-127): a key it does not know is an error, a missing key or a
// null is the zero value, and a value of the wrong type is an error.

type Json = Record<string, unknown>;

function object(value: unknown, where: string, keys: readonly string[]): Json {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DemoFixtureError(`${where} is not an object`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      throw new DemoFixtureError(`${where} has an unknown key ${key}`);
    }
  }
  return value as Json;
}

function list(value: unknown, where: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new DemoFixtureError(`${where} is not an array`);
  }
  return value;
}

function text(value: unknown, where: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new DemoFixtureError(`${where} is not a string`);
  }
  return value;
}

function integer(value: unknown, where: string): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new DemoFixtureError(`${where} is not an integer`);
  }
  return value;
}

function texts(value: unknown, where: string): string[] {
  return list(value, where).map((v, i) => text(v, `${where}[${i}]`));
}

// The row's day and time (fixtureTime in Go) as a moment before now.
function at(now: Date, row: Json, where: string): Date {
  const day = integer(row.day, `${where}.day`);
  const time = text(row.time, `${where}.time`);
  const moment = demoFixtureTime(now, day, time);
  if (!moment) {
    throw new DemoFixtureError(`${where} has a bad time ${day} ${time}`);
  }
  return moment;
}

// Go: builder.review (demo.go:241-271). A new card made at created, answered
// as the fixture says with FSRS; then "today" makes it due an hour before
// now, and "later" moves it two days past now when FSRS has it due already.
function history(
  now: Date,
  created: Date,
  value: unknown,
  where: string,
): DemoCardHistory {
  const review = object(value, where, ["answers", "due"]);
  let card = newFsrsCard(created);
  const answers: DemoCardHistory["answers"] = [];
  list(review.answers, `${where}.answers`).forEach((item, i) => {
    const place = `${where}.answers[${i}]`;
    const answer = object(item, place, ["day", "time", "rating"]);
    const answeredAt = at(now, answer, place);
    const rating = integer(answer.rating, `${place}.rating`);
    // Answers come after the card is made, one after another.
    if (
      rating < 1 ||
      rating > 4 ||
      answeredAt.getTime() < created.getTime() ||
      (card.lastReview !== null &&
        answeredAt.getTime() <= card.lastReview.getTime())
    ) {
      throw new DemoFixtureError(`${place} is a bad answer`);
    }
    let next: FsrsCard;
    try {
      next = nextFsrsCard(card, rating, answeredAt);
    } catch (error) {
      throw new DemoFixtureError(
        `${place}: ${error instanceof Error ? error.name : "error"}`,
      );
    }
    answers.push({ rating, at: answeredAt, before: card });
    card = next;
  });
  const due = text(review.due, `${where}.due`);
  if (due === "today") {
    card = { ...card, due: new Date(now.getTime() - DUE_TODAY_MS) };
  } else if (due === "later") {
    if (card.due.getTime() <= now.getTime()) {
      card = { ...card, due: new Date(now.getTime() + DUE_LATER_MS) };
    }
  } else {
    throw new DemoFixtureError(`${where} has a bad due ${due}`);
  }
  return { card, answers };
}

// Go: the practice rounds of Seed (demo.go:173-196) and builder.round
// (:233-236), with the counts the store writes (store/demo.go demoScore).
function round(
  now: Date,
  value: unknown,
  where: string,
  keys: readonly string[],
  newUuid: () => string,
): { row: Json; round: DemoRound } {
  const row = object(value, where, keys);
  const startedAt = at(now, row, where);
  const elapsedSeconds = integer(row.elapsedSeconds, `${where}.elapsedSeconds`);
  const questions = list(row.questions, `${where}.questions`).map((item, i) => {
    const place = `${where}.questions[${i}]`;
    const q = object(item, place, ["id", "answer", "noun", "prompt", "misses"]);
    return {
      id: text(q.id, `${place}.id`),
      answer: text(q.answer, `${place}.answer`),
      noun: text(q.noun, `${place}.noun`),
      prompt: text(q.prompt, `${place}.prompt`),
      misses: texts(q.misses, `${place}.misses`),
    };
  });
  return {
    row,
    round: {
      id: newUuid(),
      elapsedMs: elapsedSeconds * 1000,
      startedAt,
      createdAt: new Date(startedAt.getTime() + elapsedSeconds * 1000),
      questionCount: questions.length,
      firstTryCount: questions.filter((q) => q.misses.length === 0).length,
      missCount: questions.reduce((sum, q) => sum + q.misses.length, 0),
      questions,
    },
  };
}

const TIME_KEYS = ["day", "time"] as const;
// Go reads both kinds of round into one struct, so a preposition round may
// carry a mode too; only complement rounds keep it.
const ROUND_KEYS = [
  ...TIME_KEYS,
  "mode",
  "elapsedSeconds",
  "questions",
] as const;

// Go: demo.Seed (demo.go:121-201). Throws DemoFixtureError naming the first
// problem. UUIDs are drawn in Go's order: words, each conversation then its
// messages, preposition rounds, complement rounds.
export function buildDemoSeed(
  fixture: unknown,
  now: Date,
  newUuid: () => string,
): DemoSeed {
  const root = object(fixture, "fixture", [
    "displayName",
    "notes",
    "words",
    "conversations",
    "prepositionRecords",
    "complementRecords",
  ]);
  // Every list is checked to be one before anything is built, as Go decodes
  // the whole fixture first.
  const noteRows = list(root.notes, "notes");
  const wordRows = list(root.words, "words");
  const conversationRows = list(root.conversations, "conversations");
  const prepositionRows = list(root.prepositionRecords, "prepositionRecords");
  const complementRows = list(root.complementRecords, "complementRecords");

  const notes = noteRows.map((item, i): DemoNote => {
    const where = `notes[${i}]`;
    const row = object(item, where, [
      ...TIME_KEYS,
      "kind",
      "original",
      "corrected",
      "pinyin",
      "hints",
      "review",
    ]);
    const kind = text(row.kind, `${where}.kind`);
    if (kind !== "correction" && kind !== "translation") {
      throw new DemoFixtureError(`${where} has a bad kind ${kind}`);
    }
    const createdAt = at(now, row, where);
    return {
      kind,
      originalText: text(row.original, `${where}.original`),
      correctedText: text(row.corrected, `${where}.corrected`),
      pinyin: text(row.pinyin, `${where}.pinyin`),
      hints: texts(row.hints, `${where}.hints`),
      createdAt,
      review:
        row.review === undefined || row.review === null
          ? null
          : history(now, createdAt, row.review, `${where}.review`),
    };
  });

  const words = wordRows.map((item, i): DemoWord => {
    const where = `words[${i}]`;
    const row = object(item, where, [
      "word",
      "pinyin",
      "meaning",
      "note",
      "review",
    ]);
    const sourceNote = integer(row.note, `${where}.note`);
    if (sourceNote < 0 || sourceNote >= notes.length) {
      throw new DemoFixtureError(`${where} names note ${sourceNote}`);
    }
    const createdAt = new Date(
      notes[sourceNote].createdAt.getTime() + DEMO_WORD_DELAY_MS,
    );
    return {
      id: newUuid(),
      word: text(row.word, `${where}.word`),
      pinyin: text(row.pinyin, `${where}.pinyin`),
      meaning: text(row.meaning, `${where}.meaning`),
      sourceNote,
      createdAt,
      review:
        row.review === undefined || row.review === null
          ? { card: newFsrsCard(createdAt), answers: [] }
          : history(now, createdAt, row.review, `${where}.review`),
    };
  });

  const conversations = conversationRows.map((item, i): DemoConversation => {
    const where = `conversations[${i}]`;
    const row = object(item, where, [
      ...TIME_KEYS,
      "title",
      "model",
      "messages",
    ]);
    const createdAt = at(now, row, where);
    const id = newUuid();
    const messages = list(row.messages, `${where}.messages`).map(
      (m, j): DemoConversation["messages"][number] => {
        const place = `${where}.messages[${j}]`;
        const message = object(m, place, ["role", "text"]);
        const role = text(message.role, `${place}.role`);
        if (role !== "user" && role !== "assistant") {
          throw new DemoFixtureError(`${place} has a bad role ${role}`);
        }
        return {
          id: newUuid(),
          role,
          text: text(message.text, `${place}.text`),
        };
      },
    );
    return {
      id,
      title: text(row.title, `${where}.title`),
      modelName: text(row.model, `${where}.model`),
      ended: true,
      createdAt,
      // About a minute per message.
      updatedAt: new Date(createdAt.getTime() + messages.length * MINUTE_MS),
      messages,
    };
  });

  const prepositionRecords = prepositionRows.map(
    (item, i) =>
      round(now, item, `prepositionRecords[${i}]`, ROUND_KEYS, newUuid).round,
  );
  const complementRecords = complementRows.map((item, i) => {
    const where = `complementRecords[${i}]`;
    const built = round(now, item, where, ROUND_KEYS, newUuid);
    return { ...built.round, mode: text(built.row.mode, `${where}.mode`) };
  });

  return {
    displayName: text(root.displayName, "displayName"),
    notes,
    words,
    conversations,
    prepositionRecords,
    complementRecords,
  };
}
