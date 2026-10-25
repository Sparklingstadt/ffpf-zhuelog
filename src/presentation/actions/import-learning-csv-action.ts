"use server";

import { getCurrentMemberUser } from "@/composition/identity-container";
import { learningNotes } from "@/composition/learning-container";
import { revalidateNotes } from "@/presentation/actions/revalidate-notes";
import {
  handleLearningCsvImport,
  type ImportState,
} from "@/presentation/controllers/learning-csv-import-controller";

export type { ImportState };

export async function importLearningCsvAction(
  _previousState: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const state = await handleLearningCsvImport(formData, {
    getMember: getCurrentMemberUser,
    importCsv: (file) => learningNotes.importCsv(file),
  });
  if (state.status === "success") revalidateNotes();
  return state;
}
