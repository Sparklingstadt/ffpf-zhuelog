import {
  lineJobKindSchema,
  lineJobStatusSchema,
  type LineJob,
} from "@ffpf-zhuelog/core/domain/line/line-learning";

type PrismaLineJobRecord = Omit<LineJob, "kind" | "status"> & {
  kind: string;
  status: string;
};

// The columns are plain text guarded by CHECK constraints, so narrow them here
// instead of trusting the generated string type.
export function toLineJob(record: PrismaLineJobRecord | null): LineJob | null {
  if (!record) return null;
  return {
    ...record,
    kind: lineJobKindSchema.parse(record.kind),
    status: lineJobStatusSchema.parse(record.status),
  };
}
