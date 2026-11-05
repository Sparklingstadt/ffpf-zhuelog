import { createStudyLogGateway } from "@/infrastructure/go-api/study-log-gateway";

// The study log is read through the Go API as the signed-in user.
export const studyLog = createStudyLogGateway();
