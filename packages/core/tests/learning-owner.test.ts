import assert from "node:assert/strict";
import { test } from "node:test";

import { ListLogDates } from "@ffpf-zhuelog/core/application/calendar/use-cases/list-log-dates";
import { ExportIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/export-integration";
import { PreviewIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/preview-integration";
import { GetDailyEntry } from "@ffpf-zhuelog/core/application/learning/use-cases/get-daily-entry";
import { ImportLearningCsv } from "@ffpf-zhuelog/core/application/learning/use-cases/import-learning-csv";
import { ListDailyEntries } from "@ffpf-zhuelog/core/application/learning/use-cases/list-daily-entries";
import { ListRecentEntries } from "@ffpf-zhuelog/core/application/learning/use-cases/list-recent-entries";
import type { LearningEntryRepository } from "@ffpf-zhuelog/core/domain/learning/repositories/learning-entry-repository";
import { defineIntegration } from "@ffpf-zhuelog/core/integration";

function fakeRepository() {
  const owners: string[] = [];
  const repository: LearningEntryRepository = {
    async importBatch(ownerId) {
      owners.push(ownerId);
      return 0;
    },
    async listRecent(ownerId) {
      owners.push(ownerId);
      return { entries: [], total: 0 };
    },
    async listCreatedAt(ownerId) {
      owners.push(ownerId);
      return [];
    },
    async listByDate(ownerId) {
      owners.push(ownerId);
      return [];
    },
    async getByDateAndNumber(ownerId) {
      owners.push(ownerId);
      return null;
    },
    async trash(ownerId) {
      owners.push(ownerId);
      return false;
    },
    async restore(ownerId) {
      owners.push(ownerId);
      return false;
    },
    async purge(ownerId) {
      owners.push(ownerId);
      return false;
    },
    async emptyTrash(ownerId) {
      owners.push(ownerId);
      return 0;
    },
    async listTrashed(ownerId) {
      owners.push(ownerId);
      return { entries: [], total: 0 };
    },
    async setShared(ownerId) {
      owners.push(ownerId);
      return false;
    },
    async listSharedByOwners() {
      throw new Error("not used");
    },
  };
  return { repository, owners };
}

const date = { year: 2026, month: 10, day: 8 };
const integration = defineIntegration({
  id: "sample",
  text: {
    navLabel: "Sample list",
    title: "Sample title",
    description: "Sample description",
    listTitle: "Sample items",
    listDescription: "Sample item description",
    sources: [],
    emptyMessage: "Nothing yet",
    downloadLabel: "Download sample",
  },
  preview: () => ({ stats: [], items: [] }),
  export: () => null,
});

test("every learning use case passes the owner id to the repository", async () => {
  const { repository, owners } = fakeRepository();

  await new ListRecentEntries(repository).execute("o1", 10);
  await new ImportLearningCsv({ parse: () => [] }, repository).execute(
    "o1",
    "a.csv",
    "csv",
  );
  await new ListDailyEntries(repository).execute("o1", date);
  await new GetDailyEntry(repository).execute("o1", date, 1);
  await new ListLogDates(repository).execute("o1");
  await new ExportIntegration(repository).execute("o1", integration);
  await new PreviewIntegration(repository).execute("o1", integration);

  assert.deepEqual(owners, Array(7).fill("o1"));
});
