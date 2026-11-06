import type { PracticeKind } from "@/domain/practice/practice-quiz";
import {
  createPracticeRecordGateway,
  type PracticeRecordGateway,
} from "@/infrastructure/go-api/practice-record-gateway";

const gateways = new Map<PracticeKind, PracticeRecordGateway>();

// Finished rounds of one kind of practice go through the Go API as the
// signed-in user. One gateway per kind, made on first use.
export function practiceRecords(kind: PracticeKind): PracticeRecordGateway {
  let gateway = gateways.get(kind);
  if (!gateway) {
    gateway = createPracticeRecordGateway(kind);
    gateways.set(kind, gateway);
  }
  return gateway;
}
