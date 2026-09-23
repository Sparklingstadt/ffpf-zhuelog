"use server";

import { revalidatePath } from "next/cache";

import { getCurrentAdminUser } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import { csvImportErrorMessage } from "@/domain/learning/csv-validation-error";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export type ImportState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function importLearningCsvAction(
  _previousState: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const user = await getCurrentAdminUser();
  if (!user) {
    return {
      status: "error",
      message: "この操作を行う権限がありません。再度ログインしてください。",
    };
  }

  const file = formData.get("csvFile");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "CSVファイルを選択してください。" };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { status: "error", message: "ファイルは5MB以下にしてください。" };
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return {
      status: "error",
      message: "拡張子が.csvのファイルを選択してください。",
    };
  }

  try {
    const rowCount = await learningUseCases.importLearningCsv.execute(
      file.name,
      await file.text(),
    );
    revalidatePath("/");
    revalidatePath("/logs", "layout");
    return {
      status: "success",
      message: `${rowCount}件の学習文を登録しました。`,
    };
  } catch (error) {
    return {
      status: "error",
      message: csvImportErrorMessage(error),
    };
  }
}
