import { z } from "zod";
import {
  personalCorrectionRecordSchema,
  type PersonalCorrectionRecord,
} from "../../domain/practice/personal-correction";

export const PRACTICE_HISTORY_KEY = "zhuelog:personal-practice:v1";
export const MAX_PRACTICE_HISTORY = 100;
const historySchema = z
  .array(personalCorrectionRecordSchema)
  .max(MAX_PRACTICE_HISTORY);
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readPracticeHistory(
  storage: StoragePort,
): PersonalCorrectionRecord[] {
  const raw = storage.getItem(PRACTICE_HISTORY_KEY);
  if (!raw) return [];
  if (raw.length > 1_000_000) throw new Error("INVALID_HISTORY");
  return historySchema.parse(JSON.parse(raw));
}

export function writePracticeHistory(
  storage: StoragePort,
  records: PersonalCorrectionRecord[],
) {
  storage.setItem(
    PRACTICE_HISTORY_KEY,
    JSON.stringify(historySchema.parse(records)),
  );
}

export function clearPracticeHistory(storage: StoragePort) {
  storage.removeItem(PRACTICE_HISTORY_KEY);
}
