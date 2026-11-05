import { createComplementRecordGateway } from "@/infrastructure/go-api/complement-record-gateway";
import { createPrepositionRecordGateway } from "@/infrastructure/go-api/preposition-record-gateway";

// Completed rounds are saved through the Go API as the signed-in user.
export const prepositionRecords = createPrepositionRecordGateway();
export const complementRecords = createComplementRecordGateway();
