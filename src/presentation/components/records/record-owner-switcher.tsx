"use client";

import type { RecordOwner } from "@ffpf-zhuelog/core/application/identity/use-cases/resolve-record-owner";
import { Button } from "@/presentation/components/ui/button";
import { Label } from "@/presentation/components/ui/label";

type Props = {
  owner: RecordOwner;
  options: { ownerId: string; label: string }[];
  action: string;
};

// Admin-only switch for whose records the page shows. A plain GET form, so it
// works without JavaScript (an empty `?user=` means the admin's own records).
// With JavaScript, choosing 「自分」 leaves `user` out of the URL. Pages must
// render it for admins only.
export function RecordOwnerSwitcher({ owner, options, action }: Props) {
  if (owner.kind !== "self" && owner.kind !== "other") return null;

  const selected = owner.kind === "other" ? owner.ownerId : "";
  // An owner chosen via `?user=` that is not a listed member (e.g. a GitHub
  // ID) still has to show as selected.
  const listed = options.some((option) => option.ownerId === selected);

  return (
    <form
      method="get"
      action={action}
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        // A disabled control is left out of the submitted query.
        const select = event.currentTarget.elements.namedItem("user");
        if (select instanceof HTMLSelectElement && select.value === "") {
          select.disabled = true;
          setTimeout(() => {
            select.disabled = false;
          }, 0);
        }
      }}
    >
      <Label htmlFor="record-owner-select">表示するユーザー</Label>
      <select
        id="record-owner-select"
        name="user"
        defaultValue={selected}
        className="h-8 min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        <option value="">自分</option>
        {selected && !listed ? (
          <option value={selected}>{selected}</option>
        ) : null}
        {options.map((option) => (
          <option key={option.ownerId} value={option.ownerId}>
            {option.label}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" size="sm">
        表示
      </Button>
    </form>
  );
}
