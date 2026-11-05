import { createReviewGateway } from "@/infrastructure/go-api/review-gateway";

// Today's reviews are read and answered through the Go API as the signed-in
// user.
export const reviews = createReviewGateway();
