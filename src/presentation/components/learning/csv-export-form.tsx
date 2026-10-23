"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import type { LearningEntry } from "@/domain/learning/entities/learning-entry";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import {
  learningCsvFileName,
  toLearningCsv,
} from "@/presentation/presenters/learning-csv-export";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";

// The BOM lets Excel read the file as UTF-8; the import skips it.
const UTF8_BOM = "﻿";

function download(entries: LearningEntry[]) {
  const blob = new Blob([UTF8_BOM, toLearningCsv(entries)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = learningCsvFileName(new Date());
  link.click();
  // Revoking at once can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const checkboxClass = "size-4 shrink-0 cursor-pointer accent-primary";

// The notes arrive newest first and are written to the CSV in that order.
export function CsvExportForm({ entries }: { entries: LearningEntry[] }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const allSelected = selected.size === entries.length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(
      allSelected ? new Set() : new Set(entries.map((entry) => entry.id)),
    );
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-16 z-10 flex flex-col gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-xs backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={allSelected}
            onChange={toggleAll}
          />
          すべて選択
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span
            className="whitespace-nowrap text-sm text-muted-foreground"
            aria-live="polite"
          >
            {selected.size} / {entries.length}件を選択中
          </span>
          <Button
            type="button"
            disabled={selected.size === 0}
            onClick={() =>
              download(entries.filter((entry) => selected.has(entry.id)))
            }
          >
            <Download /> CSVをダウンロード
          </Button>
        </div>
      </div>

      <ul className="grid gap-2">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Card className="py-0 shadow-none has-[:checked]:border-primary">
              <CardContent className="p-0">
                <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    className={`${checkboxClass} mt-1`}
                    checked={selected.has(entry.id)}
                    onChange={() => toggle(entry.id)}
                  />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block whitespace-pre-line break-words text-sm font-medium">
                      {entry.correctedText}
                    </span>
                    <span className="block whitespace-pre-line break-words text-xs text-muted-foreground">
                      {entry.originalText}
                    </span>
                    <time
                      dateTime={entry.createdAt.toISOString()}
                      className="block text-xs text-muted-foreground"
                    >
                      {formatTokyoDateTime(entry.createdAt)}
                    </time>
                  </span>
                </label>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
