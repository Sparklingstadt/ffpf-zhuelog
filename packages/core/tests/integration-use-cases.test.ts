import assert from "node:assert/strict";
import { test } from "node:test";

import { ExportIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/export-integration";
import { PreviewIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/preview-integration";
import type { LearningEntryRepository } from "@ffpf-zhuelog/core/domain/learning/repositories/learning-entry-repository";
import {
  defineIntegration,
  type IntegrationFile,
  type LearningEntry,
} from "@ffpf-zhuelog/core/integration";

const entry: LearningEntry = {
  id: "entry-1",
  kind: "correction",
  originalText: "我去学校。",
  correctedText: "我去了学校。",
  pinyin: "Wǒ qù le xuéxiào.",
  createdAt: new Date("2026-09-25T00:00:00.000Z"),
  hints: [],
};

function fakeRepository(entries: LearningEntry[], total = entries.length) {
  const limits: number[] = [];
  const unused = async (): Promise<never> => {
    throw new Error("unused repository method");
  };
  const repository: LearningEntryRepository = {
    async listRecent(limit) {
      limits.push(limit);
      return { entries, total };
    },
    importBatch: unused,
    listCreatedAt: unused,
    listByDate: unused,
    getByDateAndNumber: unused,
  };
  return { repository, limits };
}

function sample(file: IntegrationFile | null) {
  const received: (readonly LearningEntry[])[] = [];
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
    preview(entries) {
      received.push(entries);
      return {
        stats: [{ label: "notes", value: String(entries.length) }],
        items: [],
      };
    },
    export(entries) {
      received.push(entries);
      return file;
    },
  });
  return { integration, received };
}

test("preview reads the newest 1,000 notes, passes them to the plugin, and reports counts", async () => {
  const { repository, limits } = fakeRepository([entry], 5);
  const { integration, received } = sample(null);
  const result = await new PreviewIntegration(repository).execute(integration);
  assert.deepEqual(limits, [1000]);
  assert.deepEqual(received, [[entry]]);
  assert.deepEqual(result, {
    sourceCount: 1,
    total: 5,
    preview: { stats: [{ label: "notes", value: "1" }], items: [] },
  });
});

test("export returns the plugin file, or null when there is nothing to export", async () => {
  const file = {
    fileName: "sample-v1.2_final.json",
    contentType: "application/json; charset=utf-8",
    body: "{}",
  };
  const { repository, limits } = fakeRepository([entry]);
  assert.deepEqual(
    await new ExportIntegration(repository).execute(sample(file).integration),
    file,
  );
  assert.equal(
    await new ExportIntegration(repository).execute(sample(null).integration),
    null,
  );
  assert.deepEqual(limits, [1000, 1000]);
});

test("export rejects file names that could break Content-Disposition", async () => {
  const { repository } = fakeRepository([entry]);
  const exportFile = (fileName: string) =>
    new ExportIntegration(repository).execute(
      sample({ fileName, contentType: "text/plain", body: "" }).integration,
    );
  for (const fileName of [
    "",
    '"quoted".json',
    ".hidden",
    "dir/file.json",
    "dir\\file.json",
    "line\r\nbreak.json",
    "space name.json",
    "単語.json",
    `${"a".repeat(96)}.json`,
  ]) {
    await assert.rejects(
      exportFile(fileName),
      /INVALID_INTEGRATION_FILE_NAME/,
      JSON.stringify(fileName),
    );
  }
  await assert.doesNotReject(exportFile(`${"a".repeat(95)}.json`));
});
