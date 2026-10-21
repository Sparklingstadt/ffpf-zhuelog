# Web のログインを Go API に移す（段階2）

段階1（`2026-10-21-go-api-on-vercel-design.md`）で Go API を Vercel の別プロジェクトとして動かせるようにした。段階2では、Web（Next.js）のログインとセッションを Go API に任せる。データの読み書き（Prisma）は段階3で移すので、ここでは変えない。

## 承認済みの方針

- 認証は Go API が持つ。Next.js は Go API のトークンを HttpOnly の Cookie に入れ、サーバーからサーバーへ Go API を呼ぶ（ブラウザは Go API を直接呼ばない）。
- Go API は Web とは別の Vercel プロジェクト。
- Web は環境変数で切り替える。`GO_API_URL` が設定されているときだけ Go API を使い、無ければ今の Auth.js のまま動く。そのため、マージしても本番の動きは変わらない（切り替えは利用者が環境変数を入れたとき）。
- スキーマは変えない（マイグレーション無し）。

## 決めたこと（このセッションで決めた点）

1. **アクセストークンの `aud` は分けない。** Web もモバイルも同じ `ffpf-zhuelog-mobile` の JWT を使う。Web のトークンはブラウザに出ず、権限もモバイルと同じなので、分ける利点が小さい。
2. **GitHub ログイン（Web）は、Next.js が PKCE と state を作り、Go API がコードを交換する。** Go API に Web 用の OAuth App の設定（`GITHUB_WEB_CLIENT_ID`・`GITHUB_WEB_CLIENT_SECRET`・`GITHUB_WEB_REDIRECT_URI`、3 つとも任意だが揃えて設定）を足し、`POST /v1/auth/github` は `redirectUri` が完全一致した方の OAuth App で交換する。Web の OAuth App は今のものを使い回す。GitHub は登録した callback URL の **下の階層** を `redirect_uri` に使えるので、新しい callback は `/api/auth/callback/github/go` にする（OAuth App の設定を変えずに済む）。
3. **ゲストは Go API がトークンを出す。** `POST /v1/auth/guest` で `role: "guest"`、`ownerId: "guest"` のトークン一式を返す。ゲストのトークンは `GET /v1/me` と `/v1/auth/*` 以外では `403` にする（今の Web でもゲストはノートを見られない）。リフレッシュトークンの表の `role` は文字列なので、`"guest"` をそのまま保存できる。
4. **`GET /v1/me` を足す。** 認証済みの利用者の情報 `{ ownerId, role, login, displayName?, accountId? }` を返す。会員は `displayName`・`accountId` を DB から読む。Web はこれで今の利用者を決める（ゲストも呼べる）。
5. **リフレッシュの猶予。** ブラウザは同時に複数の要求を出すので、同じリフレッシュトークンで同時にリフレッシュが起こる。今は 2 本目が「使い回し」と見なされ、ファミリーごと失効してログアウトされる。そこで、ローテーションから **30 秒以内** に、同じファミリーに有効なトークンが残っている状態で古いトークンが来たときは、失効させずに同じファミリーで新しいトークン一式を出す。30 秒を過ぎた古いトークン、またはファミリーが失効済みのときは今までどおり。
6. **クライアントの IP を Next.js から渡す。** Next.js から呼ぶと、Go API から見た送信元は Vercel の関数になり、全員が 1 つの IP として数えられる（ログイン試行の制限が全員で共有される）。そこで Next.js は利用者の IP を `X-Zhuelog-Client-IP` に、共有の秘密 `API_WEB_PROXY_SECRET`（32 バイト以上）を `X-Zhuelog-Proxy-Secret` に入れて送る。Go API は秘密が一致したとき（定数時間で比較）だけ、`X-Zhuelog-Client-IP` をクライアントの IP として使う（レート制限とログイン試行の制限の両方）。一致しなければ今までどおり `X-Forwarded-For` の最後の値を使う。`API_WEB_PROXY_SECRET` は Go API では任意（無ければこのヘッダーは常に無視する）。
7. **Cookie。** `zl_access`（アクセストークン、`maxAge` はトークンの寿命より 60 秒短い）と `zl_refresh`（リフレッシュトークン、`maxAge` はリフレッシュトークンの寿命）。どちらも `HttpOnly`・`SameSite=Lax`・`Path=/`、HTTPS のときは `Secure`。GitHub ログインの途中だけ `zl_oauth`（state・PKCE の verifier・戻り先、10 分）を使う。
8. **リフレッシュは `proxy.ts` で行う。** サーバーコンポーネントは Cookie を書き換えられないため。`zl_access` が無く `zl_refresh` があるとき、Go API の `/v1/auth/refresh` を呼び、新しい Cookie を応答に付け、同じ要求の `cookie` ヘッダーも書き換えてページから新しいトークンが見えるようにする。`401` なら両方の Cookie を消す。Go API に届かないときは何もしない（その要求はログインしていない扱い）。
9. **ページの入口の判定は Cookie があるかだけ。** 今の Auth.js の `authorized` と同じく、`proxy.ts` は「ログインしているか」を Cookie の有無で見て、無ければ `/signin` へ送る（`/api/*` は `401`、Server Action は通す）。本当に有効かは、ページが `GET /v1/me` で確かめる（今も各ページの guard が判定している）。
10. **今の利用者の取得は、要求ごとに 1 回だけ Go API を呼ぶ。** React の `cache()` で包む。`GET /v1/me` の結果は `AuthenticatedUser` に直す：`githubLogin` ← `login`、`githubId` ← `ownerId`、`role`、`displayName`、`accountId`。`401` は「ログインしていない」（`null`）、`403` は `role: "revoked"`、それ以外の失敗はエラーとして投げる。
11. **パスワードの変更・管理者による会員の管理は段階3で移す。** 今の Prisma の処理のままでも、`sessionVersion` を上げれば Go API の `GET /v1/me` が古いセッションを `401` にするので、整合は取れる。ログアウトの部分だけ、Go 版のときは Go のセッションを消す。

## Go API の変更

- `POST /v1/auth/guest`（レート制限付き、本文なし）→ トークン一式。
- `GET /v1/me`（認証必須、ゲストも可）→ `{ ownerId, role, login, displayName?, accountId? }`。
- `role: "guest"` を `Principal`・JWT・リフレッシュトークンで扱う。`checkCurrent` はゲストを常に有効とする。
- ルート表に「ゲストを通すか」を持たせ、`requireAuth` はゲストを既定で `403`（`forbidden`）にする。通すのは `GET /v1/me` だけ。テストで全ルートを確かめる。
- GitHub の OAuth App を 2 つ持てるようにする（モバイルは必須のまま、Web は任意）。`redirectUri` で選ぶ。
- リフレッシュの猶予（上の 5）。
- `X-Zhuelog-Client-IP` を信頼する条件（上の 6）。
- `docs/api-deployment.md` と VuePress（`docs-site/`）に、新しい環境変数とエンドポイントを書く。

## Web の変更

- `src/infrastructure/config/environment.ts` に、Go 版かどうか（`GO_API_URL`）と、その設定がそろっているか（`GO_API_URL`・`API_WEB_PROXY_SECRET`・`AUTH_GITHUB_ID`）を足す。
- `src/infrastructure/go-api/`：Go API を呼ぶ小さなクライアント（タイムアウト 10 秒、`X-Zhuelog-Client-IP` と秘密のヘッダーを付ける、エラーの形を読む）と、Cookie の読み書き。
- `GoApiCurrentUserProvider`（`CurrentUserProvider` を実装）。`identity-container.ts` が、Go 版なら これを、そうでなければ今の `AuthJsCurrentUserProvider` を使う。
- ログインの各操作（GitHub・ゲスト・パスワード）とログアウトを、Go 版なら Go API で行う。パスワードの失敗（`401`・`429`）は今と同じ 1 つの文言（`CredentialsSignin`）にする。GitHub の `403` は `AccessDenied`、それ以外の失敗は `OAuthCallbackError`。
- `src/app/api/auth/callback/github/go/route.ts`：state を確かめ、Go API でコードを交換し、Cookie を付けて戻り先へ送る。Go 版でなければ `404`。
- `src/proxy.ts`：Go 版なら上の 8・9 を行い、そうでなければ今の `auth(...)` のまま。CSP のヘッダーは両方で同じように付ける。
- `.env.example` と `docs/` に、Web 側の新しい環境変数を書く。

## テスト

- Go：新しいエンドポイント、ゲストの `403`（ルート表の全ルート）、OAuth App の選び方、リフレッシュの猶予（30 秒以内・30 秒後・ファミリー失効後）、信頼する IP ヘッダー（秘密が一致・不一致・未設定）。
- Web（Vitest）：Go API のクライアント、`GoApiCurrentUserProvider`（`200`・`401`・`403`・失敗）、proxy のリフレッシュ（成功・`401`・届かない）、GitHub の callback（state 不一致・成功・`403`）、ログインの各操作。
- e2e：CI の e2e を、今の Auth.js 版と Go 版の 2 通りで動かす。Go 版では `e2e/server.ts` が Go API もビルドして起動し（同じ e2e 用の DB）、`GO_API_URL` などを設定する。`asAdmin` は、Go 版では e2e 用の `API_JWT_SECRET` で署名したアクセストークンを `zl_access` に入れる。

## 切り替えの手順（利用者が行う）

1. Go API の Vercel プロジェクトに `GITHUB_WEB_CLIENT_ID`・`GITHUB_WEB_CLIENT_SECRET`（Web の OAuth App の値）・`GITHUB_WEB_REDIRECT_URI`（`https://<Web>/api/auth/callback/github/go`）・`API_WEB_PROXY_SECRET` を入れる。
2. Web の Vercel プロジェクトに `GO_API_URL`（Go API の URL）と同じ `API_WEB_PROXY_SECRET` を入れ、再デプロイする。
3. 戻すときは Web の `GO_API_URL` を消して再デプロイする。切り替えると、全員一度ログインし直しになる（Auth.js の Cookie は使われなくなる）。

## 範囲外

- データの読み書きを Go API に移すこと、Auth.js と Prisma の削除（段階3）。
- アクセストークンを Next.js 側で検証すること（毎回 Go API に聞く）。
