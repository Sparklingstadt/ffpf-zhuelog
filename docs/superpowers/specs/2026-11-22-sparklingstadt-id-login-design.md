# FFPF ID のログインを Sparklingstadt ID に置き換える

全体の設計は `Sparklingstadt/sparklingstadt-id` の `docs/superpowers/specs/2026-11-21-sparklingstadt-id-design.md`（5 章「クライアントの移し方」）にある。この文書は、そのうち ffpf-zhuelog の分を決める。

## なぜ

FFPF の名前をやめ、ログインの窓口を `https://id.sparklingstadt.com`（Sparklingstadt ID）の 1 つにする。zhuelog は、FFPF ID と同じ作りのクライアントをすでに自前で持っているので、4 つのサービスのうち最初に移す。

## 目標・目標でないもの

- 目標：「FFPF ID でログイン」を「Sparklingstadt ID でログイン」に置き換える。コード・表・環境変数・画面・文書から、ログインの名前としての FFPF をなくす。Sparklingstadt ID の人がログアウトしたら、ID サーバーのログインも消す。
- 目標でないもの：ほかの 4 つのログイン（ID とパスワード・ゲスト・デモ・GitHub）を変えること。リポジトリ名・ドメイン・パッケージ名の `ffpf-zhuelog` を変えること。今の FFPF ID のアカウントとデータの移行。
- 失敗とみなすもの：FFPF ID と Sparklingstadt ID の両方のボタンが並ぶ。古い `ffpf:` の持ち主のデータが、誰のものでもないまま DB に残る。

## 作り方（Approaches）

1. **名前を置き換え、通信のやり取りはそのまま使う（採用）**。Sparklingstadt ID は FFPF ID と同じパス・署名・クレームなので、検証のコードは変えずに済む。
2. 環境変数だけを新しい ID サーバーに向ける。コードは変わらないが、画面と ID に FFPF の名前が残り、目標を満たさない。
3. Auth.js などのライブラリに置き換える。今の自前の実装はテスト済みで、置き換える理由がない。

## 決めたこと

| 今                                                                                     | 変えたあと                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 表・モデル `FfpfAccount`                                                               | `SidAccount`（`FfpfAccount` は今回は空にするだけで、次のリリースで落とす。列は同じ：`id`＝sub、`email`、`displayName`、`sessionVersion`、`createdAt`、`updatedAt`、`lastLoginAt`） |
| 持ち主の ID `ffpf:<sub>`、パターン `^ffpf:[a-z0-9]{1,64}$`                             | `sid:<sub>`、`^sid:[a-z0-9]{1,64}$`                                                                                                                                                |
| 環境変数 `FFPF_ID_ISSUER`・`FFPF_ID_CLIENT_ID`・`FFPF_ID_CLIENT_SECRET`                | `SID_ISSUER`・`SID_CLIENT_ID`・`SID_CLIENT_SECRET`（規則は同じ：3 つそろわなければボタンを出さない。issuer は `https://`、ただし `localhost`・`127.0.0.1` を除く）                 |
| callback `/api/auth/callback/ffpf`                                                     | `/api/auth/callback/sid`                                                                                                                                                           |
| `zl_oauth` Cookie の `provider: "ffpf"`                                                | `provider: "sid"`                                                                                                                                                                  |
| ボタン「FFPF IDでログイン」、注記「FFPF IDではメールアドレスと表示名が利用されます。」 | 「Sparklingstadt ID でログイン」、「Sparklingstadt ID ではメールアドレスと表示名が利用されます。」                                                                                 |
| `/account/password` の「FFPF IDでログインしています」とリンク `<issuer>/id`            | 「Sparklingstadt ID でログインしています」とリンク `<issuer>/account`                                                                                                              |
| コードの識別子 `ffpf…`・`Ffpf…`・`FFPF_…`、ファイル名 `ffpf-*`                         | `sid…`・`Sid…`・`SID_…`、`sid-*`                                                                                                                                                   |

- 通信のやり取りは変えない：エンドポイントは issuer から組み立てる（`/oauth/authorize`・`/oauth/token`・`/oauth/jwks`。discovery は使わない）、`client_secret_basic`、PKCE（S256）、`state`・`nonce`、ES256 を JWKS で検証、`iss`・`aud`・`exp`・`nonce`・`email_verified` を確かめる。
- リポジトリ名・ドメイン・パッケージ名としての `ffpf-zhuelog`、過去の文書（`docs/superpowers/` の古い設計と計画）、過去のマイグレーションの中身は変えない。
- **データ**：新しいマイグレーション 1 つで、`SidAccount` を作り、`ffpf:` で始まる持ち主の行をすべての表から消し（`LearningEntry` とそのヒント、`ImportBatch`、`ReviewItem`、`ReviewLog`、`VocabularyEntry`、`ChatConversation`、`QuickQuestion`、`PrepositionPracticeRecord`、`ComplementPracticeRecord`、`Follow`（どちらの側でも）、`LineLink`、`LineLinkCode`、`LineMessage`、`Session`、`AiUsage`）、`FfpfAccount` は空にする（表は今回は落とさない。前のデプロイと Instant Rollback がまだ読むので、落とすのは次のリリースのマイグレーション）。利用者は持ち主だけで、新しい ID で作り直す。
- **ログアウト**：ログイン中の人の持ち主の ID が `sid:` で始まり、`SID_*` がそろっているときだけ、zhuelog のセッションと Cookie を消したあと、`<SID_ISSUER>/oauth/logout?client_id=<SID_CLIENT_ID>&post_logout_redirect_uri=<AUTH_URL の origin>/signin` へ送る。それ以外の人は、今までどおり `/signin` へ送る。ID サーバーには `post_logout_redirect_uri` として `<origin>/signin` を登録する。
- 本番に出す順番：このコードを先に出してよい。`SID_*` が無い間は、Sparklingstadt ID のボタンは出ない。

## 作る人に任せること

- ファイルと識別子の細かな名前（上の表の規則に従う）。
- マイグレーションの SQL の書き方（表の関係に合わせた消す順番）。
- `docs/deployment.md`・`docs/features.md`・`README.md`・`.env.example` の書き直しの文面。
