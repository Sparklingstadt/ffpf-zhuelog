import { asMember, createMember, expect, test, upload } from "./fixtures";

// What the review queue shows outside the review itself: the count on the
// review tab, what is due by kind and the last 7 days on the home, when
// each answer brings a card back, when each word comes back, and putting a
// note in review from the home.
test("the queue's count, make-up, days and next dates show where they are used", async ({
  page,
  db,
}) => {
  await createMember(db, "taro", "太郎", "member-password-1");
  await asMember(page, "taro", "member-password-1");

  // A word goes into the book and so into today's reviews.
  await page.goto("/vocabulary");
  await page.getByLabel("語句").fill("认真");
  await page.getByLabel("ピンイン").fill("rènzhēn");
  await page.getByLabel("意味").fill("まじめに");
  await page.getByRole("button", { name: "単語帳に入れる" }).click();
  await expect(page.getByText("「认真」を単語帳に入れました。")).toBeVisible();
  const card = page
    .getByRole("region", { name: "単語の一覧" })
    .getByRole("listitem");
  await expect(card).toContainText("次の復習 今日");

  // A note from the home's own card goes in too.
  await upload(
    page,
    '"今天我很busy。","今天我很忙。","Jīntiān wǒ hěn máng.","忙＝忙しい"',
  );
  await page.goto("/");
  await page.getByRole("button", { name: "復習に入れる" }).click();
  await expect(
    page.getByRole("button", { name: "復習から外す" }),
  ).toBeVisible();

  await expect(page.getByTestId("review-due-count")).toHaveText("2");
  const makeUp = page.getByRole("list", { name: "復習の内訳" });
  await expect(makeUp.getByRole("listitem")).toHaveText([
    "学習ノート 1",
    "単語帳 1",
  ]);
  const days = page.getByRole("list", { name: "この7日間" });
  await expect(days.getByRole("listitem")).toHaveCount(7);
  await expect(days.getByRole("listitem").last()).toContainText("今日");
  await expect(days.getByRole("listitem").last()).toContainText("復習なし");

  // The review tab says how many are due, on every width.
  const isPhone = (page.viewportSize()?.width ?? 0) < 1280;
  const reviewTab = isPhone
    ? page
        .getByRole("navigation", { name: "メインメニュー" })
        .getByRole("link", { name: /^復習/ })
    : page
        .getByRole("navigation", { name: "主なページ" })
        .getByRole("link", { name: /^今日の復習/ });
  await expect(reviewTab).toHaveAccessibleName(/（2問）$/);

  // Each rating says when it brings the card back.
  await page.goto("/review");
  await page.getByRole("button", { name: "めくる" }).click();
  const ratings = page.getByRole("group", { name: "思い出せた度合い" });
  for (const label of ["もう一度", "難しい", "できた", "簡単"])
    await expect(
      ratings.getByRole("button", { name: new RegExp(`^${label}`) }),
    ).toContainText(/\d+(分|時間|日|か月)後/);
  await ratings.getByRole("button", { name: /^簡単/ }).click();
  // Saved: the second card comes up.
  await expect(page.getByText("最後の1問")).toBeVisible();

  // Today now counts as a day with a review, and one review is left.
  await page.goto("/");
  await expect(page.getByTestId("review-due-count")).toHaveText("1");
  await expect(days.getByRole("listitem").last()).toContainText("復習した");
  await expect(reviewTab).toHaveAccessibleName(/（1問）$/);

  // The note is taken out from the home again.
  await page.getByRole("button", { name: "復習から外す" }).click();
  await expect(
    page.getByRole("button", { name: "復習に入れる" }),
  ).toBeVisible();
});
