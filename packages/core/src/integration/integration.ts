import type { LearningEntry } from "../domain/learning/entities/learning-entry";

export type IntegrationText = {
  navLabel: string; // Home button label
  title: string; // Page heading
  description: string; // Text under the heading
  listTitle: string; // Heading of the item list card
  listDescription: string; // Description of the item list card
  sources: string[]; // Chips that explain where items come from
  emptyMessage: string; // Shown when there are no items
  downloadLabel: string; // Download button label
};

export type IntegrationStat = { label: string; value: string };

export type IntegrationItem = {
  title: string;
  description: string;
  lang?: string; // BCP 47 language of the title, e.g. "zh-Hans"
};

export type IntegrationPreview = {
  stats: IntegrationStat[];
  items: IntegrationItem[];
};

export type IntegrationFile = {
  fileName: string;
  contentType: string;
  body: string;
};

// Plugins only transform learning notes (newest first). The app owns the
// screen, the API, and the admin check, so plugins never see requests,
// sessions, or the database.
export type Integration = {
  id: string;
  text: IntegrationText;
  preview(entries: readonly LearningEntry[]): IntegrationPreview;
  // null means there is nothing to export.
  export(entries: readonly LearningEntry[]): IntegrationFile | null;
};

export function defineIntegration(integration: Integration): Integration {
  return integration;
}
