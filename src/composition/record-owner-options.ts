import type { RecordOwner } from "@ffpf-zhuelog/core/application/identity/use-cases/resolve-record-owner";
import type { AuthenticatedUser } from "@ffpf-zhuelog/core/domain/identity/entities/authenticated-user";
import { ownerIdForAccount } from "@ffpf-zhuelog/core/domain/identity/entities/password-account";
import { passwordAccountUseCases } from "@/composition/identity-container";

export type RecordOwnerOption = {
  ownerId: string;
  label: string;
  displayName: string;
};

// Members an admin can pick as the viewed owner: "表示名（ログインID）".
export async function listRecordOwnerOptions(): Promise<RecordOwnerOption[]> {
  const accounts = await passwordAccountUseCases.list.execute();
  return accounts.map((account) => ({
    ownerId: ownerIdForAccount(account.id),
    label: `${account.displayName}（${account.loginId}）`,
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

// Member list for the switcher. The top page still renders when the database
// is down, so a failure leaves only "自分" instead of breaking the page.
async function loadOptions(): Promise<RecordOwnerOption[]> {
  try {
    return await listRecordOwnerOptions();
  } catch {
    console.error("RECORD_OWNER_OPTIONS_UNAVAILABLE");
    return [];
  }
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
