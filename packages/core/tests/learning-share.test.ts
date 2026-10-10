import assert from "node:assert/strict";
import { test } from "node:test";

import { ShareLearningEntry } from "@ffpf-zhuelog/core/application/learning/use-cases/share-learning-entry";
import type { LearningEntryRepository } from "@ffpf-zhuelog/core/domain/learning/repositories/learning-entry-repository";

type Call = [method: string, ...args: unknown[]];

function fakeRepository(result: boolean) {
  const calls: Call[] = [];
  const unused = async () => {
    throw new Error("not used");
  };
  const repository: LearningEntryRepository = {
    importBatch: unused,
    listRecent: unused,
    listCreatedAt: unused,
    listByDate: unused,
    getByDateAndNumber: unused,
    trash: unused,
    restore: unused,
    purge: unused,
    emptyTrash: unused,
    listTrashed: unused,
    listSharedByOwners: unused,
    async setShared(ownerId, id, shared) {
      calls.push(["setShared", ownerId, id, shared]);
      return result;
    },
  };
  return { repository, calls };
}

test("share passes the owner, id and flag through", async () => {
  const { repository, calls } = fakeRepository(true);
  assert.equal(
    await new ShareLearningEntry(repository).execute("o1", "e1", true),
    true,
  );
  assert.equal(
    await new ShareLearningEntry(repository).execute("o1", "e1", false),
    true,
  );
  assert.deepEqual(calls, [
    ["setShared", "o1", "e1", true],
    ["setShared", "o1", "e1", false],
  ]);
});

test("share reports false when the owner has no such note", async () => {
  const { repository } = fakeRepository(false);
  assert.equal(
    await new ShareLearningEntry(repository).execute("o1", "other", true),
    false,
  );
});
