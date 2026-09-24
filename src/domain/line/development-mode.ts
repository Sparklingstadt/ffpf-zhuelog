import { z } from "zod";

// Neither a LINE message nor an AI response may select another repository.
export const DEVELOPMENT_REPOSITORY = "Sparklingstadt/ffpf-zhuelog";
export const DEVELOPMENT_ISSUES_URL = `https://github.com/${DEVELOPMENT_REPOSITORY}/issues`;
export const issueResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("created"),
      url: z
        .string()
        .regex(
          /^https:\/\/github\.com\/Sparklingstadt\/ffpf-zhuelog\/issues\/[1-9]\d*$/,
        ),
    })
    .strict(),
  z.object({ outcome: z.literal("uncertain") }).strict(),
  z.object({ outcome: z.literal("unavailable") }).strict(),
]);
export type IssueResult = z.infer<typeof issueResultSchema>;
export const developmentStartedReply = `開発モードを開始しました。\nこれ以降のテキストは1通につき1件、公開リポジトリ ${DEVELOPMENT_REPOSITORY} のIssueとして公開されます。個人情報・APIキー・秘密情報を送らないでください。\n中文の添削・学習ノートへの保存は行いません。\n終了：/devend（開始から24時間で自動終了）\nバッテリー確認：/battery`;

export function formatIssueReply(value: unknown) {
  const result = issueResultSchema.parse(value);
  if (result.outcome === "created")
    return `仕様改善案をIssueに作成しました。\n${result.url}\n\n開発モードの終了：/devend`;
  if (result.outcome === "unavailable")
    return "Issueを作成できませんでした。MacのGitHub認証・権限を確認してください。学習ノートには保存していません。\n終了：/devend";
  return `Issue作成の結果を確認できませんでした。重複防止のため自動で再作成しません。再送する前にIssue一覧を確認してください。\n${DEVELOPMENT_ISSUES_URL}\n終了：/devend`;
}

export function makeDevelopmentIssue(id: string, text: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !text.trim() || text.length > 500)
    throw new Error("INVALID_ISSUE_INPUT");
  const marker = `<!-- zhuelog-dev:${id} -->`;
  // Literal, indented Markdown prevents message content becoming mentions,
  // remote images or instructions to a tool. No model or shell sees the text.
  const normalized = text.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
    "",
  );
  return {
    marker,
    title: `[改善案] ${normalized.split(/\r?\n/)[0].replaceAll("@", "＠").slice(0, 80)}`,
    body: `## 仕様改善案\n\n${normalized
      .split(/\r?\n/)
      .map((line) => `    ${line}`)
      .join(
        "\n",
      )}\n\n---\nLINE開発モードから登録。内容は投稿者の原文です（AIによる補完なし）。\n${marker}`,
  };
}
