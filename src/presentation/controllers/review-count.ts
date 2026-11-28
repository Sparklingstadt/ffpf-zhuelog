import { reviews } from "@/composition/review-container";
import {
  isMemberRole,
  type AuthenticatedUser,
} from "@/domain/identity/entities/authenticated-user";
import { loadOr } from "@/presentation/controllers/load-or";

// How many reviews are due now, for the badge on the review tab. Guests have
// no queue, and a failure only hides the badge: both give null. Never
// rejects, so the header can hand the promise to the browser as it is.
function loadReviewCount(user: AuthenticatedUser): Promise<number | null> {
  if (!isMemberRole(user.role)) return Promise.resolve(null);
  return loadOr("REVIEW_COUNT_UNAVAILABLE", () => reviews.countDue(), null);
}

// The AppHeader props of a signed-in page: the user and the read of their
// review count, started now (the server sends the page without waiting).
export function signedInHeaderProps(user: AuthenticatedUser): {
  user: AuthenticatedUser;
  reviewCount: Promise<number | null>;
} {
  return { user, reviewCount: loadReviewCount(user) };
}
