import { createLearningGateway } from "@/infrastructure/go-api/learning-gateway";

// Note reads, the trash, sharing and the CSV import go through the Go API as
// the signed-in user.
export const learningNotes = createLearningGateway();
