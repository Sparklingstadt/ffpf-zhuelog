import type { AccountActionState } from "@/presentation/actions/password-account-actions";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/presentation/components/ui/alert";

export function AccountResult({
  state,
  errorTitle,
}: {
  state: AccountActionState;
  errorTitle: string;
}) {
  if (state.status === "success") {
    return (
      <output className="block rounded-lg border bg-muted/50 p-3 text-sm leading-6">
        ログインID: <span className="font-mono break-all">{state.loginId}</span>
        {" / "}
        パスワード:{" "}
        <span className="font-mono break-all">{state.password}</span>
        （この画面を離れると再表示できません）
      </output>
    );
  }
  if (state.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>{errorTitle}</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  return null;
}
