import { createLineLinkGateway } from "@/infrastructure/go-api/line-link-gateway";

// LINE linking still goes through the Go API as the signed-in user (stage 10).
export const lineLink = createLineLinkGateway();
