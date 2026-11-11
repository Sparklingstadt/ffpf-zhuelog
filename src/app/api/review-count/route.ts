import { NextResponse } from "next/server";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { reviews } from "@/composition/review-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";

export const dynamic = "force-dynamic";

// How many reviews are due now, for the badge on the review tab. Guests have
// no queue, and a failure only hides the badge: both answer null.
export async function GET() {
  let count: number | null = null;
  try {
    const user = await getCurrentViewerUser();
    if (user && isMemberRole(user.role)) count = await reviews.countDue();
  } catch (error) {
    console.error("REVIEW_COUNT_UNAVAILABLE", error);
  }
  return NextResponse.json(
    { count },
    { headers: { "Cache-Control": "no-store" } },
  );
}
