"use client";

import { Volume2 } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "@/presentation/components/ui/button";
import {
  nextRate,
  pickChineseVoice,
  type LastSpoken,
} from "@/presentation/lib/speech";
import { cn } from "@/presentation/lib/utils";

// Shared by every button on the page, so a replay is noticed per text.
let lastSpoken: LastSpoken | null = null;

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

// Browsers load their voices late and say so with "voiceschanged".
function subscribe(onChange: () => void) {
  const speech = synth();
  speech?.addEventListener("voiceschanged", onChange);
  return () => speech?.removeEventListener("voiceschanged", onChange);
}

// A string, so the snapshot stays the same between renders.
function chineseVoiceUri(): string | null {
  const speech = synth();
  return speech
    ? (pickChineseVoice(speech.getVoices())?.voiceURI ?? null)
    : null;
}

function speak(text: string) {
  const speech = synth();
  const voice = speech && pickChineseVoice(speech.getVoices());
  if (!speech || !voice) return;
  const now = Date.now();
  const rate = nextRate(lastSpoken, text, now);
  lastSpoken = { text, at: now, rate };
  speech.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = rate;
  speech.speak(utterance);
}

// Reads `text` aloud in Chinese; pressing it again soon reads it slower.
// Shown only when the device has a Chinese voice (never on the server).
export function SpeakButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const voice = useSyncExternalStore(subscribe, chineseVoiceUri, () => null);
  if (!voice) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      lang="ja"
      title="読み上げる（続けて押すとゆっくり）"
      className={cn("text-muted-foreground", className)}
      onClick={() => speak(text)}
    >
      <Volume2 />
      <span className="sr-only">読み上げる</span>
    </Button>
  );
}
