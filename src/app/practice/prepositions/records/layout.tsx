import { requirePracticeRecordUser } from "@/presentation/guards/practice-guard";

// The role check runs here, outside the pages' loading skeletons: once a
// skeleton has streamed the status is 200, and a guest must still get a real
// 404 (and a signed-out visitor a real redirect).
export default async function PrepositionRecordsLayout({
  children,
}: LayoutProps<"/practice/prepositions/records">) {
  await requirePracticeRecordUser(
    "/signin?callbackUrl=/practice/prepositions/records",
  );
  return children;
}
