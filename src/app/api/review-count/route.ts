import { NextResponse } from "next/server";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { reviews } from "@/composition/review-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { loadOr } from "@/presentation/controllers/load-or";

export const dynamic = "force-dynamic";

const CODE = "REVIEW_COUNT_UNAVAILABLE";

// How many reviews are due now, for the badge on the review tab. Guests have
// no queue, and a failure only hides the badge: both answer null.
export async function GET() {
  let count: number | null = null;
  try {
    const user = await getCurrentViewerUser();
    if (user && isMemberRole(user.role))
      count = await loadOr(CODE, () => reviews.countDue(), null);
  } catch (error) {
    // Not a load failure (loadOr logged those), such as Next's redirect.
    // Still only hide the badge, and log the kind of error, never the error
    // itself.
    console.error(CODE, (error as Error)?.name);
  }
  return NextResponse.json(
    { count },
    { headers: { "Cache-Control": "no-store" } },
  );
}
