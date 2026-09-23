"use client";

import { useState } from "react";
import type { PersonalCorrectionRecord } from "@/domain/practice/personal-correction";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import { Button } from "@/presentation/components/ui/button";

export function PracticeHistory({
  records,
  onClear,
  disabled,
}: {
  records: PersonalCorrectionRecord[];
  onClear: () => void;
  disabled: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="min-w-0 space-y-4" aria-label="端末の添削履歴">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">
          この端末の添削履歴（{records.length}件）
        </h2>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => setConfirming(true)}
        >
          履歴をすべて削除
        </Button>
      </div>
      {confirming ? (
        <div className="space-y-3 rounded-lg border p-4" role="alert">
          <p>このブラウザーの添削履歴をすべて削除します。元に戻せません。</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={disabled}
              onClick={() => {
                onClear();
                setConfirming(false);
              }}
            >
              削除を確定
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              キャンセル
            </Button>
          </div>
        </div>
      ) : null}
      {records.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          添削すると、原文・添削文・ピン音・ヒントがここに表示されます。
        </p>
      ) : null}
      {records.map((record, index) => (
        <LearningEntryCard
          key={record.id}
          numberLabel={`#${records.length - index}`}
          entry={{
            ...record,
            createdAt: new Date(record.createdAt),
            hints: record.hints.map((content, position) => ({
              id: `${record.id}-${position}`,
              content,
              position,
            })),
          }}
        />
      ))}
    </section>
  );
}
