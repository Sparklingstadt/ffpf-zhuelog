import { notFound } from "next/navigation";

import { kindFromSlug, PRACTICE_KINDS } from "@/domain/practice/practice-kind";
import { requirePracticeRecordUser } from "@/presentation/guards/practice-guard";

// The kind and role checks run here, outside the pages' loading skeletons:
// once a skeleton has streamed the status is 200, and an unknown kind or a
// guest must still get a real 404 (and a signed-out visitor a real
// redirect).
export default async function PracticeRecordsLayout({
  children,
  params,
}: LayoutProps<"/practice/[kind]/records">) {
  const { kind: slug } = await params;
  const kind = kindFromSlug(slug);
  if (!kind) notFound();
  await requirePracticeRecordUser(
    `/signin?callbackUrl=${PRACTICE_KINDS[kind].recordsPath}`,
  );
  return children;
}
