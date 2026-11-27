import {
  isMemberRole,
  type AuthenticatedUser,
} from "../../domain/identity/entities/authenticated-user";
import type {
  ComplementRecord,
  ComplementRecordSummary,
  ComplementRoundMode,
} from "../../domain/practice/complement-record";
import type {
  PracticeRecord,
  PracticeRecordSummary,
} from "../../domain/practice/practice-record";
import {
  checkPracticeRound,
  PRACTICE_RECORD_ID,
  PRACTICE_RECORD_LIST_LIMIT,
  type CheckedRound,
  type ComplementRound,
  type PracticeRound,
} from "../../domain/practice/practice-round";

// The signed-in user has no practice records: signed out or a guest.
export class PracticeForbiddenError extends Error {
  override name = "PracticeForbiddenError";
}

// "invalid": the round fails the round checks. "taken": the id is another
// owner's round, which is left as it was.
export type SaveRoundResult = "saved" | "invalid" | "taken";

export type PracticeRecordsDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  // Every call names the owner whose rounds it reads or writes.
  store: {
    listPrepositions(
      ownerId: string,
      limit: number,
    ): Promise<PracticeRecordSummary[]>;
    listComplements(
      ownerId: string,
      limit: number,
    ): Promise<ComplementRecordSummary[]>;
    getPreposition(ownerId: string, id: string): Promise<PracticeRecord | null>;
    getComplement(
      ownerId: string,
      id: string,
    ): Promise<ComplementRecord | null>;
    // null: the id is another owner's.
    savePreposition(
      ownerId: string,
      round: CheckedRound,
      now: Date,
    ): Promise<PracticeRecord | null>;
    saveComplement(
      ownerId: string,
      round: CheckedRound & { mode: ComplementRoundMode },
      now: Date,
    ): Promise<ComplementRecord | null>;
  };
  now: () => Date;
};

// Preposition and complement rounds, always the signed-in user's own (the
// member an admin impersonates; the demo has its own too), never an owner from a
// form. The owner is decided first, so a refused user is refused before the
// round is checked.
export function createPracticeRecords(deps: PracticeRecordsDeps) {
  async function owner(): Promise<string> {
    const user = await deps.currentUser();
    if (!user || !isMemberRole(user.role)) throw new PracticeForbiddenError();
    return user.userId;
  }

  // Saves are checked first and given one `now` (the row's createdAt and the
  // queued misses' due). Saving the same id again keeps the first save and
  // queues its misses again; another owner's id is "taken".
  async function saved(result: Promise<unknown>): Promise<SaveRoundResult> {
    return (await result) ? "saved" : "taken";
  }

  return {
    prepositions: {
      // The newest rounds first.
      async list(): Promise<PracticeRecordSummary[]> {
        return deps.store.listPrepositions(
          await owner(),
          PRACTICE_RECORD_LIST_LIMIT,
        );
      },
      // null: not the user's round (or not a round id at all).
      async get(id: string): Promise<PracticeRecord | null> {
        const ownerId = await owner();
        if (!PRACTICE_RECORD_ID.test(id)) return null;
        return deps.store.getPreposition(ownerId, id);
      },
      async save(round: PracticeRound): Promise<SaveRoundResult> {
        const ownerId = await owner();
        const checked = checkPracticeRound("preposition", round);
        if (!checked) return "invalid";
        return saved(deps.store.savePreposition(ownerId, checked, deps.now()));
      },
    },
    complements: {
      async list(): Promise<ComplementRecordSummary[]> {
        return deps.store.listComplements(
          await owner(),
          PRACTICE_RECORD_LIST_LIMIT,
        );
      },
      async get(id: string): Promise<ComplementRecord | null> {
        const ownerId = await owner();
        if (!PRACTICE_RECORD_ID.test(id)) return null;
        return deps.store.getComplement(ownerId, id);
      },
      async save(round: ComplementRound): Promise<SaveRoundResult> {
        const ownerId = await owner();
        const checked = checkPracticeRound("complement", round);
        if (!checked) return "invalid";
        return saved(deps.store.saveComplement(ownerId, checked, deps.now()));
      },
    },
  };
}

export type PracticeRecords = ReturnType<typeof createPracticeRecords>;
