import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPreDeployReport,
  isCheckOnly,
  parseAdminArgs,
  prepareAdminSql,
  preDeployCheckSql,
} from "../scripts/prepare-better-auth-admin";

const full = [
  "--github-id",
  "123",
  "--sid-sub",
  "abc",
  "--email",
  "o@x",
  "--name",
  "Owner",
];

test("parseAdminArgs reads the four values", () => {
  assert.deepEqual(parseAdminArgs(full), {
    githubId: "123",
    sidSub: "abc",
    email: "o@x",
    name: "Owner",
  });
});

test("--check-only is a flag, not part of the four values", () => {
  assert.equal(isCheckOnly(full), false);
  assert.equal(isCheckOnly([...full, "--check-only"]), true);
  assert.deepEqual(parseAdminArgs([...full, "--check-only"]), {
    githubId: "123",
    sidSub: "abc",
    email: "o@x",
    name: "Owner",
  });
});

test("parseAdminArgs ignores a bare -- from the package runner", () => {
  assert.equal(parseAdminArgs(["--", ...full]).githubId, "123");
});

test("parseAdminArgs rejects a non-numeric github id", () => {
  assert.throws(() => parseAdminArgs(["--github-id", "abc", ...full.slice(2)]));
});

test("parseAdminArgs rejects a malformed sid sub", () => {
  for (const sub of ["ABC", "a-b", "", "a".repeat(65)]) {
    assert.throws(() =>
      parseAdminArgs([...full.slice(0, 2), "--sid-sub", sub, ...full.slice(4)]),
    );
  }
});

test("parseAdminArgs throws when a value is missing", () => {
  assert.throws(() => parseAdminArgs(full.slice(0, 2).concat(full.slice(4))));
  assert.throws(() => parseAdminArgs(full.slice(0, 6)));
  assert.throws(() => parseAdminArgs([...full.slice(0, 7), "--name"]));
  assert.throws(() => parseAdminArgs([...full, "--nope", "x"]));
});

test("prepareAdminSql takes its values as parameters", () => {
  const sql = prepareAdminSql(parseAdminArgs(full));
  assert.match(sql, /"_better_auth_admin"/);
  for (const p of ["$1", "$2", "$3", "$4"]) assert.ok(sql.includes(p));
  assert.ok(!sql.includes("Owner") && !sql.includes("o@x"));
  assert.match(sql, /DELETE FROM "_better_auth_admin"/);
  assert.match(sql, /INSERT INTO "_better_auth_admin"/);
});

const ownedTables = [
  "LearningEntry",
  "ChatConversation",
  "PrepositionPracticeRecord",
  "QuickQuestion",
  "ComplementPracticeRecord",
  "ReviewItem",
  "ReviewLog",
  "VocabularyEntry",
  "AiUsage",
  "LineLink",
  "LineLinkCode",
  "LineMessage",
];

test("preDeployCheckSql covers the 12 owned tables and both Follow columns", () => {
  const { unmapped } = preDeployCheckSql();
  for (const t of ownedTables) assert.ok(unmapped.includes(`"${t}"`), t);
  assert.ok(unmapped.includes('"followerId"'));
  assert.ok(unmapped.includes('"followeeId"'));
  assert.ok(unmapped.includes("'password:'"));
  assert.ok(unmapped.includes("'sid:'"));
});

test("preDeployCheckSql is read only and covers the collisions", () => {
  const sqls = preDeployCheckSql();
  for (const sql of Object.values(sqls)) {
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
  }
  assert.match(sqls.emailCollisions, /"SidAccount"/);
  assert.match(sqls.emailCollisions, /lower/i);
  assert.match(sqls.sidSubCollision, /"SidAccount"/);
});

test("formatPreDeployReport is ok when nothing is found", () => {
  const r = formatPreDeployReport({
    unmapped: [],
    emailCollisions: [],
    sidSubCollisions: [],
  });
  assert.equal(r.ok, true);
});

test("formatPreDeployReport names each problem", () => {
  const r = formatPreDeployReport({
    unmapped: [
      { table: "Follow", column: "followerId", count: 2, owners: "x, y" },
    ],
    emailCollisions: [{ kind: "duplicate", email: "a@x", ids: ["s1", "s2"] }],
    sidSubCollisions: [{ id: "abc" }],
  });
  assert.equal(r.ok, false);
  const text = r.lines.join("\n");
  assert.match(text, /Follow/);
  assert.match(text, /followerId/);
  assert.match(text, /x, y/);
  assert.match(text, /a@x/);
  assert.match(text, /abc/);
});
