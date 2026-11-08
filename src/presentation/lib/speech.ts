// Reading Chinese aloud with the browser's speech synthesis: which voice to
// use and how fast to read. Kept apart from the button so it can be tested
// without a browser.

// The rate of a replay: pressing the button again soon after reads slower.
export const SLOW_RATE = 0.6;
// How long after a press the next press of the same text counts as a replay.
export const REPLAY_WINDOW_MS = 10_000;

type Voice = { lang: string; localService?: boolean };

// A Mandarin voice in simplified Chinese: zh-CN, zh-Hans or cmn-Hans, in
// any case and with "_" or "-" (Android reports zh_CN).
export function isChineseVoice(voice: Voice): boolean {
  const lang = voice.lang.replace(/_/g, "-").toLowerCase();
  return /^(zh|cmn)-(cn|hans)(-|$)/.test(lang);
}

// The voice to read with: a Chinese one, preferring one on the device (it
// works offline and starts sooner) over a network one. Undefined when the
// device has none.
export function pickChineseVoice<V extends Voice>(
  voices: readonly V[],
): V | undefined {
  const chinese = voices.filter(isChineseVoice);
  return chinese.find((voice) => voice.localService) ?? chinese[0];
}

export type LastSpoken = { text: string; at: number; rate: number };

// The rate for reading `text` at `now`: normal, or slow when the same text
// was just read at normal speed. Pressing again after a slow reading goes
// back to normal.
export function nextRate(
  last: LastSpoken | null,
  text: string,
  now: number,
): number {
  const replay =
    last !== null &&
    last.text === text &&
    now - last.at < REPLAY_WINDOW_MS &&
    last.rate === 1;
  return replay ? SLOW_RATE : 1;
}
