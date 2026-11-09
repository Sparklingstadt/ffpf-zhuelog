import assert from "node:assert/strict";
import { test } from "node:test";

import {
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
    ["/vocabulary", "vocabulary"],
    ["/chat", null],
    ["/follow", null],
    ["/logsx", null],
    ["/reviews", null],
  ];
  for (const [path, page] of cases) assert.equal(mainPageOf(path), page, path);
});

test("the menu reaches every page that is not a main tab", () => {
  const member = hrefs("member");
  for (const href of [
    "/logs",
    "/study-log",
    "/import",
    "/export",
    "/logs/trash",
    "/practice/prepositions",
    "/practice/complements",
    "/practice/measure-words",
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
    "/practice/prepositions",
    "/practice/complements",
    "/practice/measure-words",
  ]);
});

test("a menu link is current on its page and below, and /logs leaves the trash alone", () => {
  assert.ok(isCurrentLink("/chat", "/chat"));
  assert.ok(
    isCurrentLink("/practice/complements/result", "/practice/complements"),
  );
  assert.ok(!isCurrentLink("/practice/complements", "/practice/prepositions"));
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
