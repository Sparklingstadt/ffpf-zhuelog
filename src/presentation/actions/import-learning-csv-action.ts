"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMemberUser } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
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
    importCsv: learningUseCases.importLearningCsv,
  });
  if (state.status === "success") {
    revalidatePath("/");
    revalidatePath("/logs", "layout");
  }
  return state;
}
