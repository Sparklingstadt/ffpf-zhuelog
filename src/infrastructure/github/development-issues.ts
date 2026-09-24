import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  DEVELOPMENT_REPOSITORY,
  issueResultSchema,
  makeDevelopmentIssue,
  type IssueResult,
} from "@/domain/line/development-mode";

const execute = promisify(execFile);
const endpoint = `https://api.github.com/repos/${DEVELOPMENT_REPOSITORY}/issues`;
const issueSchema = z.object({
  html_url: z.string(),
  body: z.string().nullable(),
  pull_request: z.unknown().optional(),
});

export class GithubDevelopmentIssues {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(
    url: string,
    method: "GET" | "POST",
    signal: AbortSignal,
    body?: unknown,
  ) {
    const response = await this.fetcher(url, {
      method,
      redirect: "error",
      signal,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error("GITHUB_REQUEST_FAILED");
    return response.json();
  }

  async publish(
    id: string,
    text: string,
    permit: () => Promise<boolean | null>,
    signal?: AbortSignal,
  ): Promise<IssueResult | null> {
    const draft = makeDevelopmentIssue(id, text);
    const deadline = AbortSignal.any([
      AbortSignal.timeout(45_000),
      ...(signal ? [signal] : []),
    ]);
    // Look through both open and closed issues, not the eventually indexed search API.
    const find = async (): Promise<IssueResult | null> => {
      for (let page = 1; page <= 10; page++) {
        const issues = z
          .array(issueSchema)
          .max(100)
          .parse(
            await this.request(
              `${endpoint}?state=all&sort=created&direction=desc&per_page=100&page=${page}`,
              "GET",
              deadline,
            ),
          );
        const existing = issues.find(
          (issue) => !issue.pull_request && issue.body?.endsWith(draft.marker),
        );
        if (existing)
          return issueResultSchema.parse({
            outcome: "created",
            url: existing.html_url,
          });
        if (issues.length < 100) return null;
      }
      // Don't publish if the bounded reconciliation scan cannot establish absence.
      throw new Error("ISSUE_SCAN_LIMIT");
    };
    try {
      const existing = await find();
      if (existing) return existing;
      const allowed = await permit();
      if (allowed === null) return null; // lease lost; do not publish or complete
      if (!allowed) return { outcome: "uncertain" };
      try {
        const created = issueSchema.parse(
          await this.request(endpoint, "POST", deadline, {
            title: draft.title,
            body: draft.body,
          }),
        );
        return issueResultSchema.parse({
          outcome: "created",
          url: created.html_url,
        });
      } catch {
        // Never POST again after any ambiguous outcome (including a timeout).
        return (await find()) ?? { outcome: "uncertain" };
      }
    } catch {
      signal?.throwIfAborted();
      return { outcome: "uncertain" };
    }
  }
}

export async function localGithubDevelopmentIssues(signal?: AbortSignal) {
  const { stdout } = await execute(
    process.env.LINE_GH_BIN || "/opt/homebrew/bin/gh",
    ["auth", "token", "--hostname", "github.com"],
    {
      shell: false,
      timeout: 10_000,
      maxBuffer: 8192,
      encoding: "utf8",
      signal,
      env: {
        NODE_ENV: "development",
        HOME: process.env.HOME,
        PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        GH_PROMPT_DISABLED: "1",
        GH_HOST: "github.com",
      },
    },
  );
  const token = stdout.trim();
  if (!token || /\s/.test(token)) throw new Error("GITHUB_AUTH_UNAVAILABLE");
  return new GithubDevelopmentIssues(token);
}
