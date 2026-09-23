export function PracticeNotice() {
  return (
    <div className="space-y-2 text-sm leading-6 text-muted-foreground">
      <p>
        自分のOpenAI APIキーで添削できます（GPT-5
        mini）。API利用料はキーの所有者に発生し、ChatGPTの定額プランとは別料金です。
      </p>
      <p>
        キーはこの画面のメモリー内だけに保持し、移動・再読み込み後は再入力が必要です。キーと原文は当アプリのサーバーを経由してOpenAIに送信します。運営者のキーへの切り替えはありません。
      </p>
      <p>
        添削履歴はこのブラウザーに最大100件保存し、アプリのDBには保存しません。ログアウト後も残るため、共用端末では利用後に「履歴をすべて削除」してください。ブラウザーのデータ削除で履歴は失われ、端末間の同期・復元はできません。
      </p>
      <p>
        OpenAI側の保持はOpenAIのポリシーに従います。AIの添削には誤りがあります。通信失敗時も料金が発生する場合があり、サービス停止時は利用できません。
      </p>
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <a
          className="underline underline-offset-4"
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noreferrer"
        >
          APIキーを作成
        </a>
        <a
          className="underline underline-offset-4"
          href="https://developers.openai.com/api/docs/pricing"
          target="_blank"
          rel="noreferrer"
        >
          API料金
        </a>
        <a
          className="underline underline-offset-4"
          href="https://developers.openai.com/api/docs/guides/your-data"
          target="_blank"
          rel="noreferrer"
        >
          OpenAIのデータ保持
        </a>
      </p>
    </div>
  );
}
