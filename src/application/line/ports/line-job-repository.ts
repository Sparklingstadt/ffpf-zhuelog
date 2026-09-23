import type { LearningEntryDraft } from "@/domain/learning/entities/learning-entry";
import type { LineInput, LineJob } from "@/domain/line/line-learning";

export interface LineJobRepository {
  enqueue(inputs: LineInput[]): Promise<void>;
  claim(userId: string): Promise<LineJob | null>;
  leased(
    id: string,
    token: string,
    userId: string,
    status: string,
  ): Promise<LineJob | null>;
  saveResult(
    job: LineJob,
    draft: LearningEntryDraft,
    csv: string,
  ): Promise<boolean>;
  finishDelivery(job: LineJob): Promise<void>;
  fail(job: LineJob, permanent: boolean, code: string): Promise<void>;
}

export interface LineMessenger {
  push(
    userId: string,
    csv: string,
    retryKey: string,
  ): Promise<"accepted" | "retry" | "rejected">;
}
