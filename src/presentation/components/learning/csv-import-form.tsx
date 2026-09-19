"use client";

import { useActionState, useEffect, useRef } from "react";
import { CheckCircle2, FileSpreadsheet, LoaderCircle } from "lucide-react";

import {
  importLearningCsvAction,
  type ImportState,
} from "@/presentation/actions/import-learning-csv-action";
import { Alert, AlertDescription, AlertTitle } from "@/presentation/components/ui/alert";
import { Button } from "@/presentation/components/ui/button";
import { Input } from "@/presentation/components/ui/input";
import { Label } from "@/presentation/components/ui/label";

const initialImportState: ImportState = { status: "idle", message: "" };

export function CsvImportForm({ disabled = false }: { disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(importLearningCsvAction, initialImportState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="csv-file">CSVファイル</Label>
        <Input id="csv-file" name="csvFile" type="file" accept=".csv,text/csv" required disabled={disabled || pending} className="cursor-pointer file:cursor-pointer" />
        <p className="text-xs leading-5 text-muted-foreground">先頭3列は「最初の文」「添削後の文」「ピン音」。4列目以降はすべてヒントとして扱います。</p>
      </div>
      <Button type="submit" className="w-full" disabled={disabled || pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : <FileSpreadsheet />}
        {pending ? "インポート中…" : "CSVをインポート"}
      </Button>
      {state.status === "success" ? (
        <Alert><CheckCircle2 /><AlertTitle>インポート完了</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert>
      ) : null}
      {state.status === "error" ? (
        <Alert variant="destructive"><AlertTitle>インポートできませんでした</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert>
      ) : null}
    </form>
  );
}
