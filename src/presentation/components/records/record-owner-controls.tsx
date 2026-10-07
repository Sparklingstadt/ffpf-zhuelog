import type { RecordOwner } from "@ffpf-zhuelog/core/application/identity/use-cases/resolve-record-owner";
import { RecordOwnerSwitcher } from "@/presentation/components/records/record-owner-switcher";
import { ViewingOtherBanner } from "@/presentation/components/records/viewing-other-banner";

type Props = {
  owner: RecordOwner;
  view: {
    options: { ownerId: string; label: string }[] | null;
    viewingName: string | null;
  };
  // The page's own path without `?user=`: the switcher's target and the
  // "back to my records" link.
  path: string;
};

// The admin switcher and the read-only banner shown above a records page.
export function RecordOwnerControls({ owner, view, path }: Props) {
  if (!view.options && !view.viewingName) return null;
  return (
    <div className="flex flex-col gap-3">
      {view.options ? (
        <RecordOwnerSwitcher
          owner={owner}
          options={view.options}
          action={path}
        />
      ) : null}
      {view.viewingName ? (
        <ViewingOtherBanner name={view.viewingName} selfHref={path} />
      ) : null}
    </div>
  );
}
