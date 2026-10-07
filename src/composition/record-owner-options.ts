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
