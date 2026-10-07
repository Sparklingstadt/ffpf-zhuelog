import assert from "node:assert/strict";
import { test } from "node:test";

import { EmptyConversationTrash } from "@ffpf-zhuelog/core/application/chat/use-cases/empty-conversation-trash";
import { ListTrashedConversations } from "@ffpf-zhuelog/core/application/chat/use-cases/list-trashed-conversations";
import { PurgeConversation } from "@ffpf-zhuelog/core/application/chat/use-cases/purge-conversation";
import { RestoreConversation } from "@ffpf-zhuelog/core/application/chat/use-cases/restore-conversation";
import { TrashConversation } from "@ffpf-zhuelog/core/application/chat/use-cases/trash-conversation";
import type { ConversationNoteRepository } from "@ffpf-zhuelog/core/domain/chat/repositories/conversation-note-repository";

type Call = [method: string, ...args: unknown[]];

function fakeRepository(result: boolean) {
  const calls: Call[] = [];
  const unused = async (): Promise<never> => {
    throw new Error("not used");
  };
  const repository: ConversationNoteRepository = {
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
      return 2;
    },
    async listTrashed(ownerId, limit) {
      calls.push(["listTrashed", ownerId, limit]);
      return { conversations: [], total: 0 };
    },
  };
  return { repository, calls };
}

const id = "00000000-0000-4000-8000-000000000001";

test("conversation trash use cases pass the owner and id through", async () => {
  const { repository, calls } = fakeRepository(true);
  assert.equal(await new TrashConversation(repository).execute("o1", id), true);
  assert.equal(
    await new RestoreConversation(repository).execute("o1", id),
    true,
  );
  assert.equal(await new PurgeConversation(repository).execute("o1", id), true);
  assert.equal(await new EmptyConversationTrash(repository).execute("o1"), 2);
  assert.deepEqual(calls, [
    ["trash", "o1", id],
    ["restore", "o1", id],
    ["purge", "o1", id],
    ["emptyTrash", "o1"],
  ]);
});

test("conversation trash use cases report a missing note as false", async () => {
  const { repository } = fakeRepository(false);
  assert.equal(
    await new TrashConversation(repository).execute("o1", id),
    false,
  );
  assert.equal(
    await new RestoreConversation(repository).execute("o1", id),
    false,
  );
  assert.equal(
    await new PurgeConversation(repository).execute("o1", id),
    false,
  );
});

test("the conversation trash lists at most 100 notes by default", async () => {
  const { repository, calls } = fakeRepository(true);
  await new ListTrashedConversations(repository).execute("o1");
  await new ListTrashedConversations(repository).execute("o1", 5);
  assert.deepEqual(calls, [
    ["listTrashed", "o1", 100],
    ["listTrashed", "o1", 5],
  ]);
});
