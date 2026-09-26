// Only these intentional validation messages may cross the server boundary.
export class CsvValidationError extends Error {}

export function csvImportErrorMessage(error: unknown) {
  return error instanceof CsvValidationError
    ? error.message
    : "学習ノートを保存できませんでした。時間をおいて再度お試しください。";
}
