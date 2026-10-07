import assert from "node:assert/strict";
import { test } from "node:test";

import { EmptyLearningTrash } from "@ffpf-zhuelog/core/application/learning/use-cases/empty-learning-trash";
import {
  ListTrashedEntries,
  TRASH_LIST_LIMIT,
} from "@ffpf-zhuelog/core/application/learning/use-cases/list-trashed-entries";
import { PurgeLearningEntry } from "@ffpf-zhuelog/core/application/learning/use-cases/purge-learning-entry";
import { RestoreLearningEntry } from "@ffpf-zhuelog/core/application/learning/use-cases/restore-learning-entry";
import { TrashLearningEntry } from "@ffpf-zhuelog/core/application/learning/use-cases/trash-learning-entry";
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
    async trash(ownerId, id) {
      calls.push(["trash", ownerId, id]);
      return result;
    },
    async restore(ownerId, id) {
      calls.push(["restore", ownerId, id]);
      return result;
    },
    async purge(ownerId, id) {
      calls.push(["purge", ownerId, id]);
      return result;
    },
    async emptyTrash(ownerId) {
      calls.push(["emptyTrash", ownerId]);
      return 3;
    },
    async listTrashed(ownerId, limit) {
      calls.push(["listTrashed", ownerId, limit]);
      return { entries: [], total: 0 };
    },
  };
  return { repository, calls };
}

test("learning trash use cases pass the owner and id through", async () => {
  const { repository, calls } = fakeRepository(true);
  assert.equal(
    await new TrashLearningEntry(repository).execute("o1", "e1"),
    true,
  );
  assert.equal(
    await new RestoreLearningEntry(repository).execute("o1", "e2"),
    true,
  );
  assert.equal(
    await new PurgeLearningEntry(repository).execute("o1", "e3"),
    true,
  );
  assert.equal(await new EmptyLearningTrash(repository).execute("o1"), 3);
  assert.deepEqual(calls, [
    ["trash", "o1", "e1"],
    ["restore", "o1", "e2"],
    ["purge", "o1", "e3"],
    ["emptyTrash", "o1"],
  ]);
});

test("learning trash use cases report a missing note as false", async () => {
  const { repository } = fakeRepository(false);
  assert.equal(
    await new TrashLearningEntry(repository).execute("o1", "e1"),
    false,
  );
  assert.equal(
    await new RestoreLearningEntry(repository).execute("o1", "e1"),
    false,
  );
  assert.equal(
    await new PurgeLearningEntry(repository).execute("o1", "e1"),
    false,
  );
});

test("the learning trash lists at most 100 notes by default", async () => {
  const { repository, calls } = fakeRepository(true);
  assert.equal(TRASH_LIST_LIMIT, 100);
  await new ListTrashedEntries(repository).execute("o1");
  await new ListTrashedEntries(repository).execute("o1", 5);
  assert.deepEqual(calls, [
    ["listTrashed", "o1", 100],
    ["listTrashed", "o1", 5],
  ]);
});
