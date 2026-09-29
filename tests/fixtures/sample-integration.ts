import { defineIntegration } from "@ffpf-zhuelog/core/integration";

export const sampleIntegration = defineIntegration({
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
