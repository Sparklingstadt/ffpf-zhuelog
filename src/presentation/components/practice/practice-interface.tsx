"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  correctionErrors,
  personalCorrectionRecordSchema,
  personalCorrectionRequestSchema,
  type CorrectionErrorCode,
  type PersonalCorrectionRecord,
} from "@/domain/practice/personal-correction";
import {
  clearPracticeHistory,
  MAX_PRACTICE_HISTORY,
  readPracticeHistory,
  writePracticeHistory,
} from "@/infrastructure/practice/browser-practice-history";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/presentation/components/ui/alert";
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";
import { Input } from "@/presentation/components/ui/input";
import { Label } from "@/presentation/components/ui/label";
import { Textarea } from "@/presentation/components/ui/textarea";
import { PracticeHistory } from "./practice-history";
import { PracticeNotice } from "./practice-notice";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const storageWarning =
  "履歴を端末に読み書きできません。表示中の結果は再読み込みで失われる場合があります。ブラウザーの保存設定を確認してください。";

// Mount the storage-backed component only after hydration; no server storage reads.
export function PracticeInterface() {
  const client = useSyncExternalStore(
    subscribe,
    clientSnapshot,
    serverSnapshot,
  );
  return client ? (
    <PracticeSession />
  ) : (
    <p role="status">添削画面を準備しています…</p>
  );
}

function PracticeSession() {
  const [initial] = useState(() => {
    try {
      return { records: readPracticeHistory(window.localStorage), warning: "" };
    } catch {
      return {
        records: [] as PersonalCorrectionRecord[],
        warning: storageWarning,
      };
    }
  });
  const [records, setRecords] = useState(initial.records);
  const [warning, setWarning] = useState(initial.warning);
  const [registered, setRegistered] = useState(false);
  const [consent, setConsent] = useState(false);
  const [originalText, setOriginalText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const apiKey = useRef("");
  const keyInput = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const unsaved = useRef<PersonalCorrectionRecord[]>([]);

  useEffect(() => {
    const forget = () => {
      apiKey.current = "";
      if (keyInput.current) keyInput.current.value = "";
      pending.current?.abort();
      setRegistered(false);
    };
    const pageHide = () => {
      forget();
    };
    window.addEventListener("pagehide", pageHide);
    return () => {
      forget();
      window.removeEventListener("pagehide", pageHide);
    };
  }, []);

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const candidate = String(new FormData(form).get("apiKey") ?? "").trim();
    form.reset();
    if (
      !consent ||
      !personalCorrectionRequestSchema.shape.apiKey.safeParse(candidate).success
    ) {
      setError(
        "同意にチェックし、sk-で始まるOpenAI APIキーを入力してください。",
      );
      return;
    }
    apiKey.current = candidate;
    setRegistered(true);
    setError("");
    setStatus("この画面にキーを登録しました。有効性は添削時に確認します。");
  }

  async function correct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const input = personalCorrectionRequestSchema.safeParse({
      apiKey: apiKey.current,
      originalText,
      consent,
    });
    if (!input.success || originalText.includes(apiKey.current)) {
      setError(correctionErrors.invalid);
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setStatus("添削しています…");
    try {
      const response = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.data),
        cache: "no-store",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(55_000),
        ]),
      });
      const payload = await response.json();
      if (!response.ok) {
        const code: CorrectionErrorCode =
          typeof payload?.code === "string" &&
          Object.hasOwn(correctionErrors, payload.code)
            ? payload.code
            : "unavailable";
        setError(correctionErrors[code]);
        if (code === "key" || code === "unauthorized") {
          apiKey.current = "";
          setRegistered(false);
        }
        setStatus("");
        return;
      }
      const record = personalCorrectionRecordSchema.parse({
        ...payload,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      });
      if (JSON.stringify(record).includes(apiKey.current))
        throw new Error("INVALID_RESULT");
      let next = [record, ...records].slice(0, MAX_PRACTICE_HISTORY);
      try {
        // Read again to respect history changes made in another tab.
        const persisted = [
          record,
          ...unsaved.current,
          ...readPracticeHistory(window.localStorage),
        ].slice(0, MAX_PRACTICE_HISTORY);
        writePracticeHistory(window.localStorage, persisted);
        next = persisted;
        unsaved.current = [];
        setWarning("");
      } catch {
        unsaved.current = [record, ...unsaved.current].slice(
          0,
          MAX_PRACTICE_HISTORY,
        );
        setWarning(storageWarning);
      }
      setRecords(next);
      setOriginalText("");
      setStatus("添削が完了しました。");
    } catch {
      setError(correctionErrors.unavailable);
      setStatus("");
    } finally {
      pending.current = null;
      setBusy(false);
    }
  }

  function clearHistory() {
    try {
      clearPracticeHistory(window.localStorage);
      unsaved.current = [];
      setRecords([]);
      setWarning("");
      setStatus("この端末の添削履歴を削除しました。");
    } catch {
      setWarning(
        "履歴を削除できませんでした。ブラウザーのサイトデータ設定から削除してください。",
      );
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>本人のAPIキーで添削</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 space-y-5">
          <PracticeNotice />
          {!registered ? (
            <form onSubmit={register} className="space-y-3">
              <div className="flex items-start gap-2">
                <input
                  id="practice-consent"
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="mt-1 size-4 shrink-0"
                />
                <Label htmlFor="practice-consent" className="leading-6">
                  自分のAPIキーを使用し、本人への課金・サーバー経由での送信・端末保存に同意します
                </Label>
              </div>
              <Label htmlFor="practice-key">OpenAI APIキー</Label>
              <Input
                ref={keyInput}
                id="practice-key"
                name="apiKey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                maxLength={503}
                placeholder="sk-…"
                required
              />
              <Button type="submit" disabled={!consent}>
                この画面にキーを登録
              </Button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <p className="text-sm">APIキー登録済み（この画面のみ）</p>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  apiKey.current = "";
                  setRegistered(false);
                  setStatus("APIキーを解除しました。");
                }}
              >
                キーを解除
              </Button>
            </div>
          )}
          <form onSubmit={correct} className="space-y-3">
            <Label htmlFor="practice-text">添削する中国語</Label>
            <Textarea
              id="practice-text"
              value={originalText}
              onChange={(event) => setOriginalText(event.target.value)}
              maxLength={500}
              rows={5}
              required
              disabled={busy}
              placeholder="今天我很busy，所以没有时间学习中文。"
              className="min-w-0 [overflow-wrap:anywhere]"
            />
            <p className="text-xs text-muted-foreground">
              {originalText.length} / 500文字 · GPT-5 mini ·
              送信ごとにAPI料金が発生します
            </p>
            <Button
              type="submit"
              disabled={!registered || busy || !originalText.trim()}
            >
              {busy ? "添削中…" : "自分のAPIキーで添削する"}
            </Button>
          </form>
          <p role="status" aria-live="polite" className="text-sm">
            {status}
          </p>
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>添削を完了できませんでした</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {warning ? (
            <Alert role="alert">
              <AlertTitle>端末保存について</AlertTitle>
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
      <PracticeHistory
        records={records}
        onClear={clearHistory}
        disabled={busy}
      />
    </div>
  );
}
