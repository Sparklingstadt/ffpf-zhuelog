import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { GithubDevelopmentIssues } from "../src/infrastructure/github/development-issues";
import {
  DEVELOPMENT_ISSUES_URL,
  developmentStartedReply,
  formatIssueReply,
  issueResultSchema,
  makeDevelopmentIssue,
} from "../src/domain/line/development-mode";
import { handleLineWebhook } from "../src/presentation/controllers/line-webhook-controller";
import type { LineJobRepository } from "../src/application/line/ports/line-job-repository";
import { routeDevelopmentMessage } from "../src/domain/line/development-routing";

test("domain routing keeps mode changes independent of persistence and expires safely", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  const input = (originalText: string, receivedAt = now) => ({
    originalText,
    receivedAt,
  });
  const off = { expiresAt: null, lastEventAt: new Date(0) };
  const started = routeDevelopmentMessage(input("/dev"), off, now);
  assert.ok(started.session.expiresAt);
  assert.equal(
    routeDevelopmentMessage(input("Improve search"), started.session, now).job
      .kind,
    "dev-issue",
  );
  assert.equal(
    routeDevelopmentMessage(input("中文改善"), started.session, now).job.kind,
    "dev-issue",
  );
  const ended = routeDevelopmentMessage(input("/devend"), started.session, now);
  assert.equal(ended.session.expiresAt, null);
  assert.equal(
    routeDevelopmentMessage(input("今天很好"), ended.session, now).job.kind,
    "correction",
  );
  assert.equal(
    routeDevelopmentMessage(input("English"), off, now).job.status,
    "IGNORED",
  );
  const late = routeDevelopmentMessage(
    input("/dev", new Date(now.getTime() - 1)),
    ended.session,
    now,
  );
  assert.equal(late.session.expiresAt, null);
  assert.match(late.job.replyText!, /受信順/);
  const expired = routeDevelopmentMessage(
    input("改善案"),
    started.session,
    new Date(now.getTime() + 86400001),
  );
  assert.equal(expired.job.kind, "dev-reply");
  assert.equal(expired.session.expiresAt, null);
});

const url = `${DEVELOPMENT_ISSUES_URL}/123`;
const json = (body: unknown, status = 200) => Response.json(body, { status });

test("development issues keep literal proposals, a fixed repository and a non-personal dedup marker", () => {
  const draft = makeDevelopmentIssue(
    "job-123",
    "検索を改善したい @someone\n![image](https://evil.test)\n<!-- spoof -->",
  );
  assert.match(draft.title, /＠someone/);
  assert.match(draft.body, /\n    !\[image\]/);
  assert.ok(draft.body.endsWith("<!-- zhuelog-dev:job-123 -->"));
  assert.match(developmentStartedReply, /公開/);
  assert.match(developmentStartedReply, /\/devend/);
  assert.match(formatIssueReply({ outcome: "created", url }), /issues\/123/);
  assert.match(
    formatIssueReply({ outcome: "uncertain" }),
    /自動で再作成しません/,
  );
  for (const bad of [
    "https://evil.test",
    "https://github.com/other/repo/issues/1",
    `${url}?token=x`,
  ])
    assert.equal(
      issueResultSchema.safeParse({ outcome: "created", url: bad }).success,
      false,
    );
  assert.throws(() => makeDevelopmentIssue("../x", "hello"));
  assert.throws(() => makeDevelopmentIssue("job", "a".repeat(501)));
});

test("publication obtains a single-use permit before exactly one POST", async () => {
  const calls: string[] = [];
  const github = new GithubDevelopmentIssues(
    "test-secret",
    async (target, init) => {
      assert.ok(
        String(target).startsWith(
          "https://api.github.com/repos/Sparklingstadt/ffpf-zhuelog/issues",
        ),
      );
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer test-secret",
      );
      assert.equal(init?.redirect, "error");
      calls.push(init!.method!);
      if (init?.method === "GET") return json([]);
      assert.deepEqual(calls, ["GET", "permit", "POST"]);
      const body = JSON.parse(String(init.body));
      assert.equal(body.title, "[改善案] 検索を改善する");
      assert.ok(body.body.endsWith("<!-- zhuelog-dev:job -->"));
      return json({ html_url: url, body: body.body });
    },
  );
  assert.deepEqual(
    await github.publish("job", "検索を改善する", async () => {
      calls.push("permit");
      return true;
    }),
    { outcome: "created", url },
  );
});

test("a lost GitHub response is reconciled from closed issues without another POST", async () => {
  let posts = 0,
    gets = 0;
  const body = makeDevelopmentIssue("job", "改善").body;
  const github = new GithubDevelopmentIssues("token", async (_target, init) => {
    if (init?.method === "POST") {
      posts++;
      throw new Error("lost response with secret");
    }
    gets++;
    return json(gets === 1 ? [] : [{ html_url: url, body, state: "closed" }]);
  });
  assert.deepEqual(await github.publish("job", "改善", async () => true), {
    outcome: "created",
    url,
  });
  assert.equal(posts, 1);
  assert.equal(gets, 2);
});

test("reclaimed or stale leases can only reconcile, not republish", async () => {
  const github = new GithubDevelopmentIssues("token", async (_target, init) => {
    assert.equal(init?.method, "GET");
    return json([]);
  });
  assert.deepEqual(await github.publish("job", "改善", async () => false), {
    outcome: "uncertain",
  });
  assert.equal(await github.publish("job", "改善", async () => null), null);
});

test("read-back uses pagination, excludes PRs and returns existing issues before requesting a permit", async () => {
  const draft = makeDevelopmentIssue("job", "改善");
  let calls = 0;
  const github = new GithubDevelopmentIssues("token", async (target, init) => {
    assert.equal(init?.method, "GET");
    calls++;
    if (calls === 1)
      return json(
        Array.from({ length: 100 }, () => ({
          html_url: url,
          body: draft.body,
          pull_request: {},
        })),
      );
    assert.match(String(target), /page=2$/);
    return json([{ html_url: url, body: draft.body }]);
  });
  assert.deepEqual(
    await github.publish("job", "改善", async () =>
      assert.fail("must not acquire permit"),
    ),
    { outcome: "created", url },
  );
});

test("authorization errors and ambiguous create failures never leak errors or retry POST", async () => {
  for (const failRead of [true, false]) {
    let posts = 0;
    const github = new GithubDevelopmentIssues(
      "token",
      async (_target, init) => {
        if (init?.method === "POST") {
          posts++;
          return json({ message: "sensitive" }, 403);
        }
        return failRead ? json({ message: "sensitive" }, 401) : json([]);
      },
    );
    assert.deepEqual(await github.publish("job", "改善", async () => true), {
      outcome: "uncertain",
    });
    assert.equal(posts, failRead ? 0 : 1);
  }
});

test("signed owner development commands and English text require explicit feature enablement", async () => {
  const config = {
    secret: "dev-test",
    accessToken: "unused",
    userId: `U${"1".repeat(32)}`,
    botId: `U${"2".repeat(32)}`,
    workerToken: "a".repeat(64),
  };
  const texts = [
    "/dev",
    "Improve search",
    "/devend",
    "/dev shell",
    "/unknown 中文",
  ];
  const base = {
    type: "message",
    mode: "active",
    timestamp: Date.now(),
    source: { type: "user", userId: config.userId },
  };
  const events = texts.map((text, i) => ({
    ...base,
    webhookEventId: `dev-${i}`,
    message: { type: "text", text },
  }));
  const body = JSON.stringify({
    destination: config.botId,
    events: [
      ...events,
      { ...events[0], source: { type: "group", userId: config.userId } },
      { ...events[0], source: { type: "user", userId: "stranger" } },
    ],
  });
  for (const enabled of [false, true]) {
    const jobs = {
      enqueue: async (inputs) => {
        assert.deepEqual(
          inputs.map((input) => input.originalText),
          enabled ? texts.slice(0, 3) : [],
        );
      },
    } as LineJobRepository;
    const request = new Request("https://example.test", {
      method: "POST",
      body,
      headers: {
        "x-line-signature": createHmac("sha256", config.secret)
          .update(body)
          .digest("base64"),
      },
    });
    assert.equal(
      (
        await handleLineWebhook(
          request,
          { ...config, developmentEnabled: enabled },
          jobs,
        )
      ).status,
      200,
    );
  }
});
