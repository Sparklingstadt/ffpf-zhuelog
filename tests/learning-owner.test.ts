import assert from "node:assert/strict";
import { test } from "node:test";

import { ImportLearningCsv } from "../src/application/learning/use-cases/import-learning-csv";
import type { LearningEntryRepository } from "../src/domain/learning/repositories/learning-entry-repository";

function fakeRepository() {
  const owners: string[] = [];
  const repository: LearningEntryRepository = {
    async importBatch(ownerId) {
      owners.push(ownerId);
      return 0;
    },
    async listSharedByOwners() {
      throw new Error("not used");
    },
  };
  return { repository, owners };
}

test("the CSV import passes the owner id to the repository", async () => {
  const { repository, owners } = fakeRepository();

  await new ImportLearningCsv({ parse: () => [] }, repository).execute(
    "o1",
    "a.csv",
    "csv",
  );

  assert.deepEqual(owners, ["o1"]);
});
