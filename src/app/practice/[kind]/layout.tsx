import { notFound } from "next/navigation";

import { kindFromSlug } from "@/domain/practice/practice-kind";

// The kind check runs here, above every loading skeleton under /practice:
// once a skeleton has streamed the status is 200, and /practice/unknown must
// still be a real 404. The pages check the kind again for their own types.
export default async function PracticeKindLayout({
  children,
  params,
}: LayoutProps<"/practice/[kind]">) {
  const { kind } = await params;
  if (!kindFromSlug(kind)) notFound();
  return children;
}
