import { createPrepositionRecordGateway } from "@/infrastructure/go-api/preposition-record-gateway";

// Finished rounds of preposition practice go through the Go API as the
// signed-in user.
export const prepositionRecords = createPrepositionRecordGateway();
