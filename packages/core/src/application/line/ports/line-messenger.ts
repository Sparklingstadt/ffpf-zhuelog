import type { LearningKind } from "../../../domain/learning/entities/learning-entry";

export interface LineMessenger {
  pushText(
    userId: string,
    text: string,
    retryKey: string,
  ): Promise<"accepted" | "retry" | "rejected">;
  push(
    userId: string,
    csv: string,
    kind: LearningKind,
    retryKey: string,
  ): Promise<"accepted" | "retry" | "rejected">;
}
