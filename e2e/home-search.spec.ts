import {
  adminOwnerId,
  asAdmin,
  expect,
  seedNotes,
  test,
  upload,
} from "./fixtures";

// The home's search: one row on wide screens; on phones only the words
// field until 絞り込む opens the filters, and open already while searching.
test("phones open the search filters with 絞り込む; wide screens show them in a row", async ({
  page,
  context,
}) => {
  await asAdmin(context);
  // The search shows once there is a note.
  await upload(
    page,
    '"今天我很busy。","今天我很忙。","Jīntiān wǒ hěn máng.","忙＝忙しい"',
  );
  await expect(page.getByText("1件の学習文を登録しました。")).toBeVisible();
  const search = page.getByRole("search", { name: "学習ノートを検索" });
  const kind = search.getByLabel("種類");
  const toggle = search.getByRole("button", { name: "絞り込む" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(search.getByLabel("語句")).toBeVisible();
  await expect(kind).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(kind).toBeVisible();
  await expect(search.getByLabel("ヒント")).toBeVisible();

  await search.getByLabel("語句").fill("忙");
  await search.getByRole("button", { name: "検索" }).click();
  await expect(page).toHaveURL(/[?&]q=%E5%BF%99/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("検索結果");
  // While searching, the filters stay open.
  await expect(kind).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(toggle).toBeHidden();
  await expect(kind).toBeVisible();
});

// % and _ are LIKE wildcards in the database search; the words must match
// literally, in the note's text and in its hints.
test("searching for 100% finds only the literal text", async ({
  page,
  context,
  db,
}) => {
  await seedNotes(db, adminOwnerId, [
    { text: "考试得了100%" },
    { text: "这次满分", hint: "「100%」的努力" },
    { text: "考试得了100分" },
    { text: "考试得了1000分" },
  ]);
  await asAdmin(context);
  await page.goto("/");
  const search = page.getByRole("search", { name: "学習ノートを検索" });
  // Enter submits on every width (phones hide the button until 絞り込む).
  await search.getByLabel("語句").fill("100%");
  await search.getByLabel("語句").press("Enter");

  await expect(page).toHaveURL(/[?&]q=100%25(&|$)/);
  await expect(
    page.getByText("条件に合う学習ノートが2件あります。", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("考试得了100%").first()).toBeVisible();
  await expect(page.getByText("这次满分").first()).toBeVisible();
  await expect(page.getByText("考试得了100分")).toHaveCount(0);
  await expect(page.getByText("考试得了1000分")).toHaveCount(0);
});
