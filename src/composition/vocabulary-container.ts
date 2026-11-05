import { createVocabularyGateway } from "@/infrastructure/go-api/vocabulary-gateway";

// The vocabulary book is read and changed through the Go API as the
// signed-in user.
export const vocabulary = createVocabularyGateway();
