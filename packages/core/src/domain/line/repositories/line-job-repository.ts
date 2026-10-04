import type { LearningEntryDraft } from "../../../domain/learning/entities/learning-entry";
import type {
  LineInput,
  LineJob,
  LineJobStatus,
} from "../../../domain/line/line-learning";
import type { GenerationFailureCode } from "../../../domain/line/generation-failure";

export interface LineJobRepository {
  enqueue(inputs: LineInput[]): Promise<void>;
  claim(userId: string): Promise<LineJob | null>;
  leased(
    id: string,
    token: string,
    userId: string,
    status: LineJobStatus,
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
