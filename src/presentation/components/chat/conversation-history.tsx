"use client";
import type { ConversationSummary } from "@ffpf-zhuelog/core/domain/chat/conversation";
import { Button } from "@/presentation/components/ui/button";
export function ConversationHistory({
  history,
  disabled,
  onOpen,
}: {
  history: (ConversationSummary & { source: string })[];
  disabled: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <details className="border-t px-4 py-4 sm:px-6">
      <summary className="cursor-pointer font-medium">
        保存した会話（{history.length}件）
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        DB履歴は別の端末からも閲覧できます。端末バックアップはログアウト後も残り、ブラウザーデータの削除で消えます。
      </p>
      <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto">
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            保存した会話はありません。
          </p>
        ) : (
          history.map((value) => (
            <Button
              key={value.id}
              type="button"
              variant="outline"
              disabled={disabled}
              className="h-auto flex-col items-start whitespace-normal py-3 text-left"
              onClick={() => onOpen(value.id)}
            >
              <span>{value.title}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(value.updatedAt).toLocaleString("ja-JP")} ·{" "}
                {value.source}
              </span>
            </Button>
          ))
        )}
      </div>
    </details>
  );
}
