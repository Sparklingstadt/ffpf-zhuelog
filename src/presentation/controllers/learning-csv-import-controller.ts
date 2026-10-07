import type { ImportLearningCsv } from "@ffpf-zhuelog/core/application/learning/use-cases/import-learning-csv";
import { csvImportErrorMessage } from "@ffpf-zhuelog/core/domain/learning/csv-validation-error";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export type ImportState = {
  status: "idle" | "success" | "error";
  message: string;
};

// Imports into the signed-in user's own notes. The viewed owner (`?user=`) is
// never read here: an admin viewing someone else still writes to their own.
export async function handleLearningCsvImport(
  formData: FormData,
  dependencies: {
    getMember: () => Promise<{ githubId?: string } | null>;
    importCsv: Pick<ImportLearningCsv, "execute">;
  },
): Promise<ImportState> {
  const user = await dependencies.getMember();
  if (!user) {
    return {
      status: "error",
      message: "この操作を行う権限がありません。再度ログインしてください。",
    };
  }
  // Older GitHub sessions have no owner ID: same guidance as saving a chat.
  if (!user.githubId) {
    return {
      status: "error",
      message: "一度ログアウトしてログインし直してください。",
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
    const rowCount = await dependencies.importCsv.execute(
      user.githubId,
      file.name,
      await file.text(),
    );
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
