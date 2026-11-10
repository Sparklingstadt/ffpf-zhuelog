import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aiHeaderLink,
  bottomPageOf,
  bottomTabs,
  isAiPath,
  isCurrentLink,
  mainPageOf,
  mainTabs,
  menuIdentity,
  menuSections,
} from "../src/presentation/presenters/site-navigation";

const hrefs = (role: Parameters<typeof menuSections>[0]) =>
  menuSections(role).flatMap((s) => s.links.map((l) => l.href));

test("members and admins get the four main pages as links", () => {
  for (const role of ["member", "admin"] as const)
    assert.deepEqual(
      mainTabs(role).map((t) => t.href),
      ["/", "/review", "/practice", "/vocabulary"],
    );
});

test("guests see review and vocabulary as members-only, without links", () => {
  const tabs = mainTabs("guest");
  assert.deepEqual(
    tabs.map((t) => t.href ?? null),
    ["/", null, "/practice", null],
  );
  assert.equal(tabs[1].unavailable, "メンバー向け");
});

test("the bottom tabs are the notes, review, LINE, quick questions and conversations", () => {
  for (const role of ["member", "admin"] as const)
    assert.deepEqual(
      bottomTabs(role).map((t) => [t.label, t.href]),
      [
        ["学習ノート", "/"],
        ["復習", "/review"],
        ["LINE 連携", "/account/line"],
        ["クイック質問", "/quick-question"],
        ["会話ノート", "/conversations"],
      ],
    );
});

test("guests and the demo see the tabs they may not open as disabled", () => {
  assert.deepEqual(
    bottomTabs("guest").map((t) => t.href ?? t.unavailable),
    ["/", "メンバー向け", "メンバー向け", "メンバー向け", "メンバー向け"],
  );
  assert.deepEqual(
    bottomTabs("member", { demo: true }).map((t) => t.href ?? t.unavailable),
    ["/", "/review", "デモ対象外", "デモ対象外", "/conversations"],
  );
});

test("every path lands under the right bottom tab", () => {
  const cases: [string, string | null][] = [
    ["/", "notes"],
    ["/logs/trash", "notes"],
    ["/review", "review"],
    ["/study-log", "review"],
    ["/account/line", "line"],
    ["/account/password", null],
    ["/quick-question", "quickQuestion"],
    ["/conversations", "conversations"],
    ["/conversations/2026/11/9/1", "conversations"],
    ["/practice", null],
    ["/vocabulary", null],
    ["/chat", null],
  ];
  for (const [path, page] of cases)
    assert.equal(bottomPageOf(path), page, path);
});

test("every path lands under the right main page", () => {
  const cases: [string, string | null][] = [
    ["/", "notes"],
    ["/logs", "notes"],
    ["/logs/2026/11/9/1", "notes"],
    ["/logs/trash", "notes"],
    ["/import", "notes"],
    ["/export", "notes"],
    ["/review", "review"],
    ["/study-log", "review"],
    ["/practice", "practice"],
    ["/practice/complements/records/abc", "practice"],
    ["/practice/measure-words", "practice"],
    ["/practice/aspect-particles", "practice"],
    ["/vocabulary", "vocabulary"],
    ["/chat", null],
    ["/follow", null],
    ["/logsx", null],
    ["/reviews", null],
  ];
  for (const [path, page] of cases) assert.equal(mainPageOf(path), page, path);
});

test("the menu reaches every page that is not a bottom tab or the notes", () => {
  const member = hrefs("member");
  for (const href of [
    "/practice",
    "/vocabulary",
    "/logs",
    "/study-log",
    "/import",
    "/export",
    "/logs/trash",
    "/practice/prepositions",
    "/practice/complements",
    "/practice/measure-words",
    "/practice/aspect-particles",
    "/chat",
    "/conversations",
    "/quick-question",
    "/follow",
    "/account/line",
    "/account/password",
  ])
    assert.ok(member.includes(href), href);
  assert.ok(!member.includes("/admin/accounts"));
  assert.equal(new Set(member).size, member.length, "no link twice");

  const admin = hrefs("admin");
  assert.ok(
    admin.includes("/admin/accounts") && admin.includes("/admin/ai-usage"),
  );
  assert.ok(
    !admin.includes("/account/password"),
    "admins have no password here",
  );

  assert.deepEqual(hrefs("guest"), [
    "/practice",
    "/practice/prepositions",
    "/practice/complements",
    "/practice/measure-words",
    "/practice/aspect-particles",
  ]);
});

test("a menu link is current on its page and below, and /logs leaves the trash alone", () => {
  assert.ok(isCurrentLink("/chat", "/chat"));
  assert.ok(
    isCurrentLink("/practice/complements/result", "/practice/complements"),
  );
  assert.ok(!isCurrentLink("/practice/complements", "/practice/prepositions"));
  assert.ok(isCurrentLink("/practice", "/practice"));
  assert.ok(!isCurrentLink("/practice/complements", "/practice"));
  assert.ok(isCurrentLink("/logs/2026/11/9", "/logs"));
  assert.ok(!isCurrentLink("/logs/trash", "/logs"));
  assert.ok(isCurrentLink("/logs/trash", "/logs/trash"));
});

test("the menu names the person by role", () => {
  assert.deepEqual(menuIdentity({ role: "guest", githubLogin: "" }), {
    name: "ゲスト",
    roleLabel: "ゲスト",
  });
  assert.deepEqual(menuIdentity({ role: "admin", githubLogin: "octo" }), {
    name: "@octo",
    roleLabel: "管理者",
  });
  assert.deepEqual(
    menuIdentity({
      role: "member",
      githubLogin: "password:1",
      displayName: "デモ",
    }),
    { name: "デモ", roleLabel: "メンバー" },
  );
});

test("the demo menu leaves out what Go refuses the demo", () => {
  const demo = menuSections("member", { demo: true }).flatMap((section) =>
    section.links.map((link) => link.href),
  );
  for (const href of [
    "/chat",
    "/quick-question",
    "/follow",
    "/account/line",
    "/account/password",
    "/admin/accounts",
  ])
    assert.ok(!demo.includes(href), href);
  for (const href of [
    "/practice",
    "/vocabulary",
    "/logs",
    "/study-log",
    "/import",
    "/logs/trash",
    "/practice/prepositions",
    "/conversations",
  ])
    assert.ok(demo.includes(href), href);
  // Without the flag a member's menu is unchanged.
  assert.deepEqual(
    menuSections("member", { demo: false }),
    menuSections("member"),
  );
});

test("the demo account is labelled demo", () => {
  assert.deepEqual(
    menuIdentity({
      role: "member",
      githubLogin: "demo",
      displayName: "デモ",
      demo: true,
    }),
    { name: "デモ", roleLabel: "デモ" },
  );
});

test("the header links members to the AI questions, but not guests or the demo", () => {
  for (const role of ["member", "admin"] as const)
    assert.deepEqual(aiHeaderLink(role), {
      label: "AI に聞く",
      href: "/quick-question",
    });
  assert.equal(aiHeaderLink("guest"), null);
  assert.equal(aiHeaderLink("member", { demo: true }), null);
});

test("the AI link is current on the questions, the chat and the conversations", () => {
  for (const path of [
    "/quick-question",
    "/questions/abc",
    "/chat",
    "/conversations/2026/11/09",
  ])
    assert.equal(isAiPath(path), true, path);
  for (const path of ["/", "/review", "/chatter", "/account/line"])
    assert.equal(isAiPath(path), false, path);
});
