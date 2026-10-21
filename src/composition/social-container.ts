import { createSocialGateway } from "@/infrastructure/go-api/social-gateway";

// Follows, the member list and the shared-notes timeline go through the Go
// API as the signed-in user.
export const socialNetwork = createSocialGateway();
