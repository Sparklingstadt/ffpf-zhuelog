import { KeyRound } from "lucide-react";

import { EmptyState } from "@/presentation/components/layout/empty-state";

// Learning notes and follows belong to a stable owner ID, which older
// sessions lack.
export function ReauthNotice({ subject }: { subject: string }) {
  return (
    <EmptyState
      icon={KeyRound}
      title="再ログインが必要です"
      description={`${subject}を表示するには、一度ログアウトしてログインし直してください。`}
    />
  );
}
