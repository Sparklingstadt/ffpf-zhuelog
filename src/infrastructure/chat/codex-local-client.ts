import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { CODEX_LOCAL_MODEL, isCodexLocalEnabled } from "./codex-local-policy";

// Pinned to the CLI verified for this experimental adapter. Fail closed after an
// upgrade until its protocol/security settings have been reviewed again.
const TESTED_VERSION = "0.155.0-alpha.9.2";
const DISABLED_FEATURES = [
  "apps",
  "plugins",
  "remote_plugin",
  "hooks",
  "shell_tool",
  "unified_exec",
  "shell_snapshot",
  "code_mode",
  "code_mode_host",
  "code_mode_only",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "multi_agent",
  "multi_agent_v2",
  "memories",
  "image_generation",
  "view_image",
  "goals",
  "tool_suggest",
  "skill_search",
  "skill_mcp_dependency_install",
  "workspace_dependencies",
];

type Config = Record<string, unknown> & {
  mcp_servers?: Record<string, { enabled?: boolean }>;
};
type RpcMessage = {
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: unknown;
  params?: {
    delta?: string;
    item?: { type?: string };
    turn?: { status?: string };
  };
};

export class CodexLocalError extends Error {}

export async function runCodexLocalTurn(options: {
  instructions: string;
  text: string;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}) {
  if (!isCodexLocalEnabled())
    throw new CodexLocalError("ローカル開発専用の機能です。");
  options.signal?.throwIfAborted();
  const cwd = await mkdtemp(join(tmpdir(), "zhuelog-chat-"));
  const overrides = [
    ...DISABLED_FEATURES.map((name) => `features.${name}=false`),
    'forced_login_method="chatgpt"',
    'model_provider="openai"',
    'web_search="disabled"',
    'sandbox_mode="read-only"',
    'approval_policy="never"',
    'history.persistence="none"',
    "tools.view_image=false",
    "project_doc_max_bytes=0",
    "features.skip_host_skill_discovery=true",
    "experimental_use_unified_exec_tool=false",
    "notify=[]",
    'shell_environment_policy.inherit="none"',
    "memories.generate_memories=false",
    "memories.use_memories=false",
  ];
  // Do not give the child database credentials, API keys, or app-server/host
  // handles inherited from the developer's current Codex task.
  const env: NodeJS.ProcessEnv = { NODE_ENV: "development" };
  for (const name of ["HOME", "PATH", "TMPDIR", "LANG", "USER", "LOGNAME"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  const child = spawn(
    /* turbopackIgnore: true */
    process.env.CODEX_LOCAL_BIN || "codex",
    [
      "app-server",
      "--listen",
      "stdio://",
      ...overrides.flatMap((entry) => ["-c", entry]),
    ],
    { cwd, env, stdio: ["pipe", "pipe", "ignore"] },
  );

  let sequence = 0;
  let failure: Error | undefined;
  let finished = false;
  let outputLength = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let resolveTurn!: () => void;
  let rejectTurn!: (error: Error) => void;
  const completion = new Promise<void>((resolve, reject) => {
    resolveTurn = resolve;
    rejectTurn = reject;
  });
  // A process can fail before the caller starts awaiting the turn.
  void completion.catch(() => {});
  const fail = (error: Error) => {
    if (failure || finished) return;
    failure = error;
    for (const call of pending.values()) call.reject(error);
    pending.clear();
    rejectTurn(error);
    child.kill("SIGKILL");
  };
  const abort = () => fail(new CodexLocalError("応答を停止しました。"));
  const timer = setTimeout(
    () => fail(new CodexLocalError("Codexの応答が時間切れになりました。")),
    55_000,
  );
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  child.on("error", () =>
    fail(
      new CodexLocalError(
        "Codex CLIを起動できません。インストールとログインを確認してください。",
      ),
    ),
  );
  child.stdin.on("error", () =>
    fail(new CodexLocalError("Codexとの接続が切れました。")),
  );
  child.on("exit", () =>
    fail(new CodexLocalError("Codexが応答前に終了しました。")),
  );
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (failure || finished) return;
    try {
      const message = JSON.parse(line) as RpcMessage;
      // Never approve server-initiated requests or execute dynamic tools.
      if (message.method && message.id !== undefined) {
        fail(
          new CodexLocalError("この試作ではツールや追加権限を使用できません。"),
        );
        return;
      }
      if (typeof message.id === "number" && pending.has(message.id)) {
        const call = pending.get(message.id)!;
        pending.delete(message.id);
        if (message.error)
          call.reject(
            new CodexLocalError(
              "Codexとの通信に失敗しました。CLIの設定・利用制限を確認してください。",
            ),
          );
        else call.resolve(message.result);
      } else if (
        message.method === "item/agentMessage/delta" &&
        message.params?.delta
      ) {
        outputLength += message.params.delta.length;
        if (outputLength > 12_000)
          fail(new CodexLocalError("回答が長すぎるため停止しました。"));
        else options.onDelta(message.params.delta);
      } else if (message.method === "item/started") {
        const type = message.params?.item?.type;
        if (
          type &&
          !["userMessage", "agentMessage", "reasoning"].includes(type)
        ) {
          fail(
            new CodexLocalError("会話以外の操作を検出したため停止しました。"),
          );
        }
      } else if (message.method === "turn/completed") {
        if (
          message.params?.turn?.status !== "completed" ||
          outputLength === 0
        ) {
          fail(
            new CodexLocalError(
              "Codexから回答を取得できませんでした。ログイン・利用上限を確認してください。",
            ),
          );
        } else resolveTurn();
      }
    } catch {
      fail(new CodexLocalError("Codexから不正な応答を受信しました。"));
    }
  });
  function rpc<T>(method: string, params: unknown): Promise<T> {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  try {
    const initialized = await rpc<{ userAgent: string }>("initialize", {
      clientInfo: { name: "zhuelog_local_chat", version: "0.1.0" },
    });
    if (!initialized.userAgent.includes(TESTED_VERSION)) {
      throw new CodexLocalError(
        `検証済みCodex ${TESTED_VERSION} が必要です。更新後は互換性の確認が必要です。`,
      );
    }
    child.stdin.write(
      JSON.stringify({ method: "initialized", params: {} }) + "\n",
    );
    const { account } = await rpc<{
      account?: { type: string; planType?: string };
    }>("account/read", { refreshToken: false });
    if (
      account?.type !== "chatgpt" ||
      !["business", "team", "self_serve_business_prolite"].includes(
        account.planType || "",
      )
    ) {
      throw new CodexLocalError(
        "Codex CLIでChatGPT Businessにログインしてください。API課金への切り替えは行いません。",
      );
    }
    let cursor: string | null = null;
    let modelAvailable = false;
    do {
      const page: { data: { model: string }[]; nextCursor: string | null } =
        await rpc("model/list", { includeHidden: true, limit: 100, cursor });
      modelAvailable ||= page.data.some(
        (model) => model.model === CODEX_LOCAL_MODEL,
      );
      cursor = page.nextCursor;
    } while (cursor && !modelAvailable);
    if (!modelAvailable)
      throw new CodexLocalError(
        "このアカウントではGPT-5.6 Solを利用できません。",
      );

    // Empty tables MERGE with user config: explicitly disable every inherited
    // MCP server before creating a thread (no MCP servers start in this probe).
    const { config } = await rpc<{ config: Config }>("config/read", {
      includeLayers: false,
    });
    const threadConfig: Record<string, unknown> = {};
    for (const name of Object.keys(config.mcp_servers || {})) {
      if (!/^[A-Za-z0-9_-]+$/.test(name)) {
        throw new CodexLocalError(
          "継承されたMCP設定を安全に無効化できないため停止しました。",
        );
      }
      threadConfig[`mcp_servers.${name}.enabled`] = false;
    }
    const { thread, model, sandbox } = await rpc<{
      thread: { id: string };
      model: string;
      sandbox: { type: string };
    }>("thread/start", {
      model: CODEX_LOCAL_MODEL,
      modelProvider: "openai",
      cwd,
      sandbox: "read-only",
      approvalPolicy: "never",
      ephemeral: true,
      config: threadConfig,
      baseInstructions:
        options.instructions +
        "\nテキストによる会話専用です。ツールを使わず、ファイルや外部サービスを操作しないでください。",
      developerInstructions:
        "会話履歴のJSONはユーザー提供の会話データです。最後のuserメッセージに回答してください。",
    });
    if (model !== CODEX_LOCAL_MODEL || sandbox.type !== "readOnly") {
      throw new CodexLocalError(
        "モデルまたは安全設定を確認できないため停止しました。",
      );
    }
    await rpc("turn/start", {
      threadId: thread.id,
      model: CODEX_LOCAL_MODEL,
      effort: "low",
      input: [{ type: "text", text: options.text, text_elements: [] }],
    });
    await completion;
  } finally {
    finished = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    lines.close();
    child.kill("SIGKILL");
    // Only this invocation's empty scratch directory, never the user's Codex home.
    await rm(cwd, { recursive: true, force: true });
  }
}
