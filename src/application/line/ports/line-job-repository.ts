import type { LearningEntryDraft } from "@/domain/learning/entities/learning-entry";
import type { LineInput, LineJob } from "@/domain/line/line-learning";
import type { GenerationFailureCode } from "@/domain/line/generation-failure";

export interface LineJobRepository {
  enqueue(inputs: LineInput[]): Promise<void>;
  claim(
    userId: string,
    supportsBattery?: boolean,
    supportsDevelopment?: boolean,
  ): Promise<LineJob | null>;
  beginIssue(job: LineJob): Promise<boolean>;
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
  saveReply(
    job: LineJob,
    text: string,
    failureCode?: GenerationFailureCode,
  ): Promise<boolean>;
  finishDelivery(job: LineJob): Promise<void>;
  fail(job: LineJob, permanent: boolean, code: string): Promise<void>;
}

export interface LineMessenger {
  pushText(
    userId: string,
    text: string,
    retryKey: string,
  ): Promise<"accepted" | "retry" | "rejected">;
  push(
    userId: string,
    csv: string,
    retryKey: string,
  ): Promise<"accepted" | "retry" | "rejected">;
}
