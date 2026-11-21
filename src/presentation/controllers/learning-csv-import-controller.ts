import type { CsvImportResult } from "@/application/learning/learning-notes";
import {
  attemptGoAction,
  type ActionState,
} from "@/presentation/controllers/action-state";

export type ImportState = ActionState;

// Imports into the signed-in user's own notes. The viewed owner (`?user=`) is
// never read here: an admin viewing someone else still writes to their own.
// importCsv checks the file's size, extension and rows and answers with the
// message to show.
export async function handleLearningCsvImport(
  formData: FormData,
  dependencies: {
    getMember: () => Promise<{ githubId?: string } | null>;
    importCsv: (file: File) => Promise<CsvImportResult>;
  },
): Promise<ImportState> {
  const user = await dependencies.getMember();
  if (!user) {
    return {
      status: "error",
      message: "この操作を行う権限がありません。再度ログインしてください。",
    };
  }
  // Older GitHub sessions have no owner ID: ask the user to sign in again.
  if (!user.githubId) {
    return {
      status: "error",
      message: "一度ログアウトしてログインし直してください。",
    };
  }

  const file = formData.get("csvFile");
  // An empty file gets the same message from importCsv.
  if (!(file instanceof File)) {
    return { status: "error", message: "CSVファイルを選択してください。" };
  }

  return attemptGoAction("CSV_IMPORT_FAILED", async () => {
    const result = await dependencies.importCsv(file);
    if (!result.ok) return { status: "error", message: result.message };
    return {
      status: "success",
      message: `${result.count}件の学習文を登録しました。`,
    };
  });
}
