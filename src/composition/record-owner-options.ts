import type { RecordOwner } from "@/application/identity/use-cases/resolve-record-owner";
import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { memberAccounts } from "@/composition/account-container";
import { loadOr } from "@/presentation/controllers/load-or";

export type RecordOwnerOption = {
  ownerId: string;
  label: string;
  displayName: string;
};

// Members an admin can pick as the viewed owner, by user id: "表示名（ログイ
// ンID）", or the name alone for a Sparklingstadt ID member.
export async function listRecordOwnerOptions(): Promise<RecordOwnerOption[]> {
  const accounts = await memberAccounts.list();
  return accounts.map((account) => ({
    ownerId: account.id,
    label: account.loginId
      ? `${account.displayName}（${account.loginId}）`
      : account.displayName,
    displayName: account.displayName,
  }));
}

// Name shown in the "viewing" banner for an owner, falling back to the owner ID itself.
export function labelForOwner(
  ownerId: string,
  options: RecordOwnerOption[],
): string {
  return (
    options.find((option) => option.ownerId === ownerId)?.displayName ?? ownerId
  );
}

export type RecordOwnerView = {
  // Switcher choices, loaded for admins only; null hides the switcher.
  options: RecordOwnerOption[] | null;
  // Name for the "viewing" banner while another person's records are shown.
  viewingName: string | null;
};

// Member list for the switcher. The top page still renders when the load
// fails, so a failure leaves only "自分" instead of breaking the page. Only
// Next control flow, such as the redirect to /signin, passes through.
async function loadOptions(): Promise<RecordOwnerOption[]> {
  return loadOr(
    "RECORD_OWNER_OPTIONS_UNAVAILABLE",
    () => listRecordOwnerOptions(),
    [],
  );
}

// What a records page shows above its content for the viewed owner.
export async function loadRecordOwnerView(
  user: AuthenticatedUser | null,
  owner: RecordOwner,
): Promise<RecordOwnerView> {
  const options = user?.role === "admin" ? await loadOptions() : null;
  return {
    options,
    viewingName:
      owner.kind === "other"
        ? labelForOwner(owner.ownerId, options ?? [])
        : null,
  };
}
