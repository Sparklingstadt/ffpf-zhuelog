# Codex Business ローカル会話試作

本番Vercelとは別の、管理者専用・このMac限定の実験です。
通常のOpenAI API接続は変更せず、明示的に以下で起動した場合だけ切り替えます。

```sh
codex login status
npm run dev:codex
```

http://localhost:3000/chat を開き、従来どおり許可済みGitHubアカウントでログインしてください。
`127.0.0.1` にだけバインドします。トンネル、ポート公開、リバースプロキシ経由では使用しないでください。
CodexがPATH上にない場合は `CODEX_LOCAL_BIN` に実行ファイルの絶対パスを指定できます。

- Codex CLI `0.155.0-alpha.9.2` と `gpt-5.6-sol` で検証。CLI更新時は互換性確認まで停止します。
- このMacで既にログインしているChatGPT BusinessのCodex利用枠を使用します。無制限ではありません。
- APIキーを子プロセスへ渡さず、失敗時もAPI課金や別モデルにフォールバックしません。
- 管理者認証、開発環境、同一Origin・loopback Hostをサーバー側で検証します。
- `NODE_ENV=production` またはVercelでは無効。フラグを誤設定してもAPIに自動切り替えません。
- 通信は標準入出力のみ。App ServerのHTTP/WebSocketポートは開きません。
- シェル、コード実行、ブラウザー、画像、プラグイン、メモリなどを無効化し、継承されたMCPサーバーも個別に無効化します。read-only sandboxを確認してから会話を開始します。
- サーバーからの権限・ツール要求は承認せず停止。同時生成は1件、55秒で終了、停止ボタンや切断でも子プロセスを終了します。
- 会話はJSON形式で毎回再送し、ephemeral threadを利用します。アプリDBへの保存はしませんが、OpenAIへの送信やCodexの診断ログまで「保存ゼロ」を保証するものではありません。秘密情報は入力しないでください。
- 出力の1600トークン指定は通常API用です。App Server試作では55秒・出力12000文字の打ち切りを設けていますが、厳密なトークン予算ではありません。

通常モードに戻すにはサーバーを停止し `npm run dev` で起動してください。`.env` や本番設定の書き換えは不要です。

オフライン回帰テスト: `npm run test:unit`。実モデルを呼び出さないためCodex利用枠を消費しません。

ブラウザー検証: 開発サーバーを止めた状態で `npx tsx scripts/check-codex-local.mts`。
使い捨ての認証シークレットと署名付きテストCookieで認証・ゲスト拒否・送受信を確認します。
`--live` を付けると、モックの代わりにBusinessの利用枠で短い質問を1回送信します。

公式資料: [App Server](https://learn.chatgpt.com/docs/app-server)、[設定リファレンス](https://learn.chatgpt.com/docs/config-file/config-reference)。
実験的なインターフェースを使うため、本番への転用は別途設計・安全性確認が必要です。
