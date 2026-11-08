import type { Page } from "@playwright/test";

import { asGuest, expect, test } from "./fixtures";

// Headless Chromium has no voices, so each test puts in a stand-in for the
// browser's speech synthesis that records what it is asked to read.
async function stubSpeech(page: Page, lang: string) {
  await page.addInitScript((voiceLang) => {
    const spoken: { text: string; rate: number; lang: string }[] = [];
    const voices = [
      { name: "Stub", lang: voiceLang, voiceURI: "stub", localService: true },
    ];
    const synth = Object.assign(new EventTarget(), {
      getVoices: () => voices,
      speak: (u: { text: string; rate: number; lang: string }) =>
        spoken.push({ text: u.text, rate: u.rate, lang: u.lang }),
      cancel: () => {},
    });
    Object.defineProperty(window, "speechSynthesis", { value: synth });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: class {
        rate = 1;
        lang = "";
        voice: unknown = null;
        constructor(public text: string) {}
      },
    });
    (window as unknown as { spoken: typeof spoken }).spoken = spoken;
  }, lang);
}

async function solveFirstQuestion(page: Page) {
  await page.goto("/practice/prepositions");
  const choices = page.getByRole("group", { name: "介詞を選ぶ" });
  for (const button of await choices.getByRole("button").all()) {
    await button.click();
    if (await choices.getByRole("button", { name: /（正解）$/ }).count()) break;
  }
}

test("the example is read aloud, slower when pressed again", async ({
  page,
}) => {
  await stubSpeech(page, "zh-CN");
  await asGuest(page);
  await solveFirstQuestion(page);
  const example = page.locator('p[lang="zh-CN"]', {
    has: page.getByRole("button", { name: "読み上げる" }),
  });
  // The sentence alone, without the button's hidden label.
  const sentence = await example.evaluate(
    (el) => el.firstChild?.textContent?.trim() ?? "",
  );
  expect(sentence).toMatch(/\p{Script=Han}/u);
  const speak = example.getByRole("button", { name: "読み上げる" });

  await speak.click();
  await speak.click();
  await speak.click();
  expect(
    await page.evaluate(
      () => (window as unknown as { spoken: unknown }).spoken,
    ),
  ).toEqual([
    { text: sentence, rate: 1, lang: "zh-CN" },
    { text: sentence, rate: 0.6, lang: "zh-CN" },
    { text: sentence, rate: 1, lang: "zh-CN" },
  ]);
});

test("without a Chinese voice there is no button to read aloud", async ({
  page,
}) => {
  await stubSpeech(page, "en-US");
  await asGuest(page);
  await solveFirstQuestion(page);
  await expect(page.locator('[lang="zh-Latn-pinyin"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "読み上げる" })).toHaveCount(0);
});
