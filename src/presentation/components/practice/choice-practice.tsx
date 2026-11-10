"use client";

import {
  ArrowRight,
  BookPlus,
  Check,
  History,
  RotateCcw,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from "react";

import {
  accuracyPercent,
  answerOf,
  scoreRound,
  type PrepositionAnswer,
} from "@/domain/practice/preposition-record";
import {
  progressPercent,
  type PrepositionQuestion,
} from "@/domain/practice/preposition-quiz";
import type {
  SavePrepositionRoundInput,
  SavePrepositionRoundResult,
} from "@/presentation/actions/preposition-record-actions";
import {
  getExamplePinyinSnapshot,
  getServerExamplePinyinSnapshot,
  setExamplePinyinPreference,
  subscribeToExamplePinyin,
} from "@/infrastructure/preferences/example-pinyin-store";
import { PrepositionAnswerList } from "@/presentation/components/practice/preposition-answer-list";
import { PrepositionStats } from "@/presentation/components/practice/preposition-stats";
import { SpeakButton } from "@/presentation/components/speech/speak-button";
import {
  draftVocabularyAction,
  saveVocabularyAction,
} from "@/presentation/actions/vocabulary-actions";
import { VocabularyAddForm } from "@/presentation/components/vocabulary/vocabulary-add-form";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { cn } from "@/presentation/lib/utils";

// Moves focus to the button that just appeared. Unlike autoFocus it does not
// center the button: the page stays where it is, so the progress bar stays
// in view, unless the button is out of sight (on a phone, below the bottom
// tabs), when it scrolls just far enough to show it.
export function focusInPlace(button: HTMLButtonElement | null) {
  if (!button) return;
  button.focus({ preventScroll: true });
  button.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

// The example sentence of a solved question, with the pinyin of the whole
// sentence above it when there is one. With the "hide" setting on, the
// pinyin waits behind a button so the learner reads the sentence first.
export function SolvedExample({
  question,
  canAddToVocabulary = false,
}: {
  question: Pick<
    PrepositionQuestion,
    "example" | "examplePinyin" | "translation"
  >;
  // Members and admins may pick words of the sentence into their vocabulary
  // book in today's review. The practice leaves it out, to keep the
  // question and "next" in view.
  canAddToVocabulary?: boolean;
}) {
  const preference = useSyncExternalStore(
    subscribeToExamplePinyin,
    getExamplePinyinSnapshot,
    getServerExamplePinyinSnapshot,
  );
  const [revealed, setRevealed] = useState(false);
  const hidden = preference === "hidden";

  return (
    <>
      {question.examplePinyin ? (
        hidden && !revealed ? (
          <p>
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              ピンインを見る
            </button>
          </p>
        ) : (
          <p lang="zh-Latn-pinyin" className="text-xs text-muted-foreground">
            {question.examplePinyin}
          </p>
        )
      ) : null}
      <p lang="zh-CN" className="text-sm">
        {question.example}
        <SpeakButton text={question.example} className="ml-1 align-middle" />
      </p>
      <p className="text-sm text-muted-foreground">{question.translation}</p>
      {question.examplePinyin ? (
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(event) =>
              setExamplePinyinPreference(
                event.target.checked ? "hidden" : "shown",
              )
            }
            className="size-3.5 accent-primary"
          />
          例文のピンインを最初は隠す
        </label>
      ) : null}
      {canAddToVocabulary ? (
        <details className="group mx-auto w-full max-w-xl rounded-lg border text-left">
          <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
            <BookPlus className="size-4" aria-hidden="true" />
            例文の語句を単語帳に入れる
          </summary>
          <div className="border-t p-3">
            <VocabularyAddForm
              sentence={question.example}
              draftVocabulary={draftVocabularyAction}
              saveVocabulary={saveVocabularyAction}
            />
          </div>
        </details>
      ) : null}
    </>
  );
}

export function ProgressBar({
  done,
  total,
  ref,
  className,
}: {
  done: number;
  total: number;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}) {
  return (
    <div ref={ref} className={cn("flex items-center gap-3", className)}>
      <div
        role="progressbar"
        aria-label="進捗"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${progressPercent(done, total)}%` }}
        />
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-sm text-muted-foreground">
        {done} / {total}
      </span>
    </div>
  );
}

// Whether a key press is meant for a field or a shortcut of the browser, and
// so not for a page's own keys.
export function isTypingOrShortcut(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat)
    return true;
  const target = event.target as HTMLElement | null;
  return Boolean(
    target?.isContentEditable || target?.closest("input, textarea, select"),
  );
}

// Whether the key press lands on a button or a link, which Enter and Space
// already press.
export function isOnControl(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  return Boolean(target?.closest("button, a, summary"));
}

export function Choice({
  preposition,
  compact,
  state,
  disabled,
  onPick,
  shortcut,
}: {
  preposition: string;
  compact: boolean;
  state: "idle" | "correct" | "wrong";
  disabled: boolean;
  onPick: () => void;
  // The number key that picks it, when the page listens for one.
  shortcut?: number;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      aria-keyshortcuts={shortcut ? String(shortcut) : undefined}
      aria-label={
        state === "correct"
          ? `${preposition}（正解）`
          : state === "wrong"
            ? `${preposition}（不正解）`
            : preposition
      }
      onClick={onPick}
      className={cn(
        "relative min-h-14 font-medium disabled:opacity-100 roomy:min-h-20",
        compact
          ? "h-auto whitespace-normal px-6 py-3 text-lg leading-relaxed roomy:py-4 roomy:text-xl"
          : "h-14 text-2xl roomy:h-20 roomy:text-3xl",
        state === "correct" &&
          "border-primary bg-primary text-primary-foreground dark:border-primary dark:bg-primary",
        state === "wrong" &&
          "border-destructive/50 bg-destructive/10 text-destructive line-through dark:border-destructive/50 dark:bg-destructive/20",
      )}
    >
      {preposition}
      {state === "correct" ? (
        <Check className="absolute top-2 right-2 size-5" />
      ) : state === "wrong" ? (
        <X className="absolute top-2 right-2 size-5" />
      ) : null}
    </Button>
  );
}

type SaveState =
  | { status: "idle" | "saving" | "saved" }
  | { status: "error"; message: string };

type FinishedRound = {
  id: string;
  startedAt: Date;
  elapsedMs: number;
  questions: PrepositionAnswer[];
};

// The round as it stands when its last question is answered, under a new id
// that a retried save reuses.
function finishRound(
  startedAt: number,
  questions: PrepositionAnswer[],
): FinishedRound {
  return {
    id: crypto.randomUUID(),
    startedAt: new Date(startedAt),
    elapsedMs: Date.now() - startedAt,
    questions,
  };
}

// Shared four-choice round for prepositions and complements. A wrong pick is crossed out and the
// question stays until the right one is picked. The accuracy, misses and time
// run above the question; when the last one is answered a member's or
// admin's round is saved (`canSave`), and the result shows them again.
export function ChoicePractice({
  initialQuiz,
  canSave,
  buildNextQuiz,
  saveRound,
  recordsHref,
  choiceLabel,
  compactHeading = false,
}: {
  initialQuiz: PrepositionQuestion[];
  canSave: boolean;
  buildNextQuiz: () => PrepositionQuestion[];
  saveRound: (
    input: SavePrepositionRoundInput,
  ) => Promise<SavePrepositionRoundResult>;
  recordsHref: string;
  choiceLabel: string;
  compactHeading?: boolean;
}) {
  const [quiz, setQuiz] = useState(initialQuiz);
  const [index, setIndex] = useState(0);
  const [wrong, setWrong] = useState<string[]>([]);
  const [solved, setSolved] = useState(false);
  // The questions answered so far, with their misses.
  const [answers, setAnswers] = useState<PrepositionAnswer[]>([]);
  // Both start at the same moment, so the server and the browser show 0:00.
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [round, setRound] = useState<FinishedRound | null>(null);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const progress = useRef<HTMLDivElement>(null);
  const choicesRef = useRef<HTMLDivElement>(null);

  // On a short screen the page header can push the choices out of sight
  // (below the bottom tabs, or the window's edge). Then the round starts
  // scrolled to its progress bar, so the question and all four choices
  // show without scrolling; the header is still above.
  useEffect(() => {
    const choices = choicesRef.current;
    if (!choices) return;
    const reserved = parseFloat(
      getComputedStyle(document.documentElement).scrollPaddingBottom,
    );
    const bottom = window.innerHeight - (Number.isNaN(reserved) ? 0 : reserved);
    if (choices.getBoundingClientRect().bottom > bottom)
      progress.current?.scrollIntoView({ block: "start" });
  }, []);

  const total = quiz.length;
  const finished = index >= total;
  const done = Math.min(total, index + (solved ? 1 : 0));
  const question = finished ? null : quiz[index];
  const score = scoreRound(answers);
  const elapsedMs = round ? round.elapsedMs : now - startedAt;

  // The clock ticks until the last question is answered.
  useEffect(() => {
    if (round) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [round]);

  async function store(finishedRound: FinishedRound) {
    setSave({ status: "saving" });
    try {
      const result = await saveRound({
        ...finishedRound,
        startedAt: finishedRound.startedAt.toISOString(),
      });
      setSave(result.ok ? { status: "saved" } : { status: "error", ...result });
    } catch {
      setSave({
        status: "error",
        message: "記録を保存できませんでした。もう一度お試しください。",
      });
    }
  }

  function pick(preposition: string) {
    if (!question || solved || wrong.includes(preposition)) return;
    if (preposition !== question.answer) {
      setWrong((picked) => [...picked, preposition]);
      return;
    }
    setSolved(true);
    const answered = [...answers, answerOf(question, wrong)];
    setAnswers(answered);
    if (index + 1 < total) return;
    const finishedRound = finishRound(startedAt, answered);
    setNow(startedAt + finishedRound.elapsedMs);
    setRound(finishedRound);
    if (canSave) void store(finishedRound);
  }

  // After scrolling down to "next" on a phone, the next question starts out
  // of sight; bring the round back from the progress bar down.
  function showQuestion() {
    progress.current?.scrollIntoView({
      block: "nearest",
      behavior: scrollBehavior(),
    });
  }

  function next() {
    setIndex((current) => current + 1);
    setWrong([]);
    setSolved(false);
    showQuestion();
  }

  // The keys 1 to 4 pick the choices in the order they show, and Enter goes
  // on once the answer is found. Keys on a button or link are left to it, so
  // Enter on the focused "next" counts once.
  useEffect(() => {
    if (!question) return;
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingOrShortcut(event)) return;
      if (event.key === "Enter") {
        if (!solved || isOnControl(event)) return;
        event.preventDefault();
        next();
        return;
      }
      const position = Number(event.key);
      if (!Number.isInteger(position) || position < 1) return;
      const choice = question!.choices[position - 1];
      if (choice === undefined) return;
      event.preventDefault();
      pick(choice);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function restart() {
    const startAt = Date.now();
    setQuiz(buildNextQuiz());
    setIndex(0);
    setWrong([]);
    setSolved(false);
    setAnswers([]);
    setStartedAt(startAt);
    setNow(startAt);
    setRound(null);
    setSave({ status: "idle" });
    showQuestion();
  }

  return (
    <div className="flex flex-col gap-3 roomy:gap-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <ProgressBar
          ref={progress}
          done={done}
          total={total}
          className="min-w-48 flex-1"
        />
        {/* The result shows them again, larger. */}
        {finished ? null : (
          <PrepositionStats
            accuracy={accuracyPercent(score.firstTryCount, score.questionCount)}
            missCount={score.missCount + (solved ? 0 : wrong.length)}
            elapsedMs={elapsedMs}
          />
        )}
      </div>

      {question ? (
        // Wide screens put the explanation beside the question, so it shows
        // without scrolling; narrower ones put it under the choices.
        <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-5">
          <Card className="py-4 roomy:py-12">
            <CardContent className="flex flex-col items-center gap-5 roomy:gap-10">
              <div className="flex flex-col items-center gap-2 text-center">
                <p className="text-sm text-muted-foreground">
                  {question.meaning}
                </p>
                {/* With compactHeading this is the complement mode's name,
                    which the page title already gives on small screens. */}
                <p
                  lang="zh-CN"
                  className={cn(
                    "font-semibold tracking-tight",
                    compactHeading
                      ? "text-xl cramped:hidden roomy:text-2xl"
                      : "text-5xl roomy:text-7xl",
                  )}
                >
                  {question.noun}
                </p>
                <p
                  lang="zh-CN"
                  className="text-lg leading-relaxed text-muted-foreground roomy:text-2xl"
                >
                  {question.prompt}
                </p>
              </div>

              <div
                ref={choicesRef}
                role="group"
                aria-label={choiceLabel}
                lang="zh-CN"
                className="grid w-full max-w-md grid-cols-2 gap-3"
              >
                {question.choices.map((preposition, position) => (
                  <Choice
                    key={preposition}
                    preposition={preposition}
                    shortcut={position + 1}
                    compact={compactHeading}
                    state={
                      solved && preposition === question.answer
                        ? "correct"
                        : wrong.includes(preposition)
                          ? "wrong"
                          : "idle"
                    }
                    disabled={solved || wrong.includes(preposition)}
                    onPick={() => pick(preposition)}
                  />
                ))}
              </div>
              {!solved && wrong.length > 0 ? (
                <p className="text-sm text-destructive" role="status">
                  ちがいます。もう一度選んでください。
                </p>
              ) : null}
              {/* Only where a keyboard is likely: wide screens with a mouse. */}
              <p className="hidden text-xs text-muted-foreground lg:pointer-fine:block">
                キーボードの 1〜4 で選べます · Enter で次の問題
              </p>
            </CardContent>
          </Card>

          <div aria-live="polite" className="contents">
            {solved ? (
              <Card className="gap-0 py-0">
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="order-1 space-y-1">
                    <p className="text-sm font-medium text-primary">正解！</p>
                    <p className="flex flex-wrap items-baseline gap-x-3">
                      <span
                        lang="zh-CN"
                        className="text-2xl font-semibold tracking-tight"
                      >
                        {question.answer}
                      </span>
                      <span className="text-muted-foreground">
                        {question.pinyin}
                      </span>
                      <span lang="zh-CN" className="text-sm">
                        {question.phrase}
                      </span>
                    </p>
                  </div>
                  <div className="order-3 space-y-1 border-t pt-4">
                    <p className="text-xs font-medium text-muted-foreground">
                      例文
                    </p>
                    <SolvedExample question={question} />
                  </div>
                  {/* On phones and tablets "next" comes right under the
                      answer, so it shows without scrolling past the example
                      and covers nothing; wide screens end the panel with it. */}
                  <div className="order-2 xl:order-4">
                    <Button
                      size="lg"
                      onClick={next}
                      ref={focusInPlace}
                      className="w-full"
                    >
                      {index + 1 < total ? "次へ" : "結果を見る"} <ArrowRight />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <p className="hidden rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground lg:block">
                選ぶと、ここに正解と例文が出ます。
              </p>
            )}
          </div>
        </div>
      ) : (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center gap-6">
            <p className="text-2xl font-semibold tracking-tight">
              {total}問 終了！
            </p>
            <PrepositionStats
              accuracy={accuracyPercent(
                score.firstTryCount,
                score.questionCount,
              )}
              missCount={score.missCount}
              elapsedMs={elapsedMs}
              size="lg"
            />
            <p className="text-sm text-muted-foreground">
              1回目で正解した問題:{" "}
              <strong className="font-mono text-base text-foreground">
                {score.firstTryCount}
              </strong>{" "}
              / {total}
            </p>
            <PrepositionAnswerList
              answers={answers}
              choiceLabel={choiceLabel}
              onlyMissed
              className="max-w-md"
            />
            <SaveStatus
              canSave={canSave}
              save={save}
              onRetry={round ? () => void store(round) : undefined}
            />
            <div className="flex flex-wrap justify-center gap-3">
              <Button size="lg" onClick={restart} ref={focusInPlace}>
                <RotateCcw /> もう一度
              </Button>
              {canSave ? (
                <Button asChild size="lg" variant="outline">
                  <Link href={recordsHref}>
                    <History /> 過去の記録
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SaveStatus({
  canSave,
  save,
  onRetry,
}: {
  canSave: boolean;
  save: SaveState;
  onRetry?: () => void;
}) {
  if (!canSave)
    return (
      <p className="text-sm text-muted-foreground">
        ゲストの練習は記録に残りません。
      </p>
    );
  return (
    <div aria-live="polite" className="flex flex-col items-center gap-2">
      {save.status === "saving" ? (
        <p className="text-sm text-muted-foreground">記録を保存しています…</p>
      ) : save.status === "saved" ? (
        <p className="text-sm text-muted-foreground">記録に保存しました。</p>
      ) : save.status === "error" ? (
        <>
          <p role="alert" className="text-sm text-destructive">
            {save.message}
          </p>
          {onRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry}>
              保存し直す
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
