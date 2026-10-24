# 管理者が会員として操作する

管理者（GitHub でログインした admin）が、会員（パスワード会員）を選んで「その会員として」操作できるようにする。たとえば管理者が test01 として会話練習を使うと、その会話ノートは test01 のものとして保存される。

## 承認済みの方針

- **管理者の権限のまま、記録の持ち主だけを切り替える。** `role` は `admin` のままなので、会話練習や管理画面など管理者の機能はそのまま使える。作る・読む・消す記録（ノート・ゴミ箱・共有・フォロー・タイムライン・CSV・会話ノート）は、すべて選んだ会員のものになる。
- 会話練習を会員に開放するのは範囲外。test01 本人が会話ノートを見られるようにするには、別の変更が要る。
- 方式は「Web が Go API にヘッダーで相手を伝える」（下の 1）。なりすまし用のトークンを Go が発行する案と、`?user=` を書き込みのルートにも広げる案は採らない。
- スキーマは変えない（マイグレーション無し）。

## 決めたこと

1. **ヘッダー `X-Zhuelog-Act-As: <ownerId>`。** 認証つきのルートで、管理者のトークンと一緒に付けると、そのリクエストの持ち主が `<ownerId>` の会員になる。Go は毎回、管理者のトークンを今までどおり確かめる（署名・期限・許可リスト）ので、許可リストから外された管理者はすぐ使えなくなる。サーバーには状態を持たない。
2. **確かめる順番**（`requireAuth` の中、トークンの確認とゲストの判定の後）：
   1. ヘッダーが無ければ、今までどおり。値が空でも「無い」とは扱わず、下の 3 で `400` にする。
   2. 呼んだのが admin でなければ `403 forbidden`「他の人として操作できるのは管理者だけです。」（会員がヘッダーを付けたとき）。
   3. ヘッダーが 2 つ以上、または値が `^password:[a-z0-9]{1,64}$`（フォローと同じ） に合わなければ `400 invalid_request`。なれるのは **会員だけ** で、admin（GitHub の数値 ID）やゲストにはなれない。
   4. その `PasswordAccount` が無ければ `404 not_found`「会員が見つかりません。」。
   5. 通ったら、`Principal` の `OwnerID` を会員の `ownerId` にし、`ActorID` に admin の GitHub ID を入れる。`Role`・`Login` は admin のまま。
3. **`auth.Principal.ActorID`。** なりすまし中だけ値がある（admin の `ownerId`）。持ち主を使うハンドラーは今までどおり `OwnerID` を使うので、ハンドラーの変更は要らない。
4. **`auth.Service.ActAs(ctx, p, ownerId) (Principal, error)`。** 上の 2-2〜2-5 を行う。会員の有無は `Store.FindPasswordAccountByID` で確かめる。`requireAuth` はこれを呼ぶ（`Auth` インターフェースに足す）。
5. **`GET /v1/me`。** なりすまし中は、`ownerId` に会員の `ownerId`、`role` に `admin`、`login` に admin の GitHub ログイン名を返し、さらに `actingAs: { ownerId, loginId, displayName }` を付ける（会員の情報は DB から読む）。なりすまし中でなければ `actingAs` は付けない。会員が見つからなくなっていたら `404`（2-4 と同じ）。
6. **使えなくするルート。** LINE の連携（`GET /v1/line/link`・`POST /v1/line/link-code`・`DELETE /v1/line/link`）は、なりすまし中は `403 forbidden`「会員として操作している間は使えません。」。そのまま通すと、管理者の LINE が会員に結び付いてしまうため。パスワードの変更（`POST /v1/account/password`）は、今も admin には `403` なので変わらない。管理者だけのルート（`/v1/admin/accounts*`）は持ち主を使わないので、そのまま使える。
7. **`?user=` との関係。** `readOwner` の「自分」は、なりすまし中は会員になる。`role` は admin のままなので、`?user=` で他の会員を読むこともできる。
8. **ログ。** なりすましが通ったリクエストごとに、`acting as member` を Info で出す（`actor`＝admin の ID、`owner`＝会員の `ownerId`、`path`）。中身やトークンは出さない。
9. **Web の Cookie `zl_act_as`。** 値は会員の `ownerId`。`HttpOnly`・`SameSite=Lax`・`Path=/`、HTTPS では `Secure`、`maxAge` はリフレッシュトークンと同じ 30 日。ログイン（3 種類とも）・ログアウトのときに消す。
10. **ヘッダーを付ける場所。** Web が Go を呼ぶ入口は 3 つなので、そこで `zl_act_as` を読んでヘッダーに付ける：`asSignedInUser`（`goApiAuthed`・`goUploadAuthed`）、`GoApiCurrentUserProvider` の `GET /v1/me`、チャットの中継（`/api/chat`）。`client.ts` の `CallerInit` に `actAs?: string` を足し、`callerHeaders` がヘッダーにする。
11. **Web は Go が認めたときだけ「なりすまし中」と扱う。** Go API は手動でデプロイするので、Web だけが新しくなることがある。古い Go はヘッダーを無視し、記録は admin 自身のものになってしまう。そこで：
    - `AuthenticatedUser` に `actingAs?: { ownerId, loginId, displayName }` を足し、`GET /v1/me` の `actingAs` から入れる。
    - Cookie があるのに `actingAs` が無いとき（古い Go）は、`actingAs` を付けず `actAsIgnored: true` にする。帯に「会員として操作できませんでした。管理者に戻ってください。」を出す。
    - Cookie があって Go が `404`（会員がいない）・`400`・`403` を返したときは、Cookie を外して `GET /v1/me` をもう一度呼び、`actAsIgnored: true` にする（Server Component は Cookie を消せないので、消すのは「管理者に戻る」の操作）。
12. **始める・やめる。** Server Action を 2 つ足す。
    - `startActingAs(ownerId)`：admin であること（`RequireAdminUser`）を確かめ、`ownerId` を `isOwnerId` と `password:` で確かめ、ヘッダー付きで `GET /v1/me` を呼んで `actingAs.ownerId` が一致したときだけ Cookie を書き、`/` へ送る。一致しなければ Cookie を書かず、管理画面にエラーを出す。
    - `stopActing()`：Cookie を消して `/admin/accounts` へ送る。
13. **画面。**
    - `/admin/accounts` の各会員の行に「この会員として操作」ボタン。
    - なりすまし中は、全ページの上部（`layout.tsx`）に帯：「{表示名}（{loginId}）として操作中」と「管理者に戻る」ボタン。`actAsIgnored` のときは上の警告と「管理者に戻る」。
    - 画面に出す名前や「自分の記録」の判定は、今までどおり `githubId`（＝`ownerId`）を使うので、ページの変更は要らない。

## Go API の変更

- `auth.Principal.ActorID`、`auth.Service.ActAs`、`auth.Me` に `ActingAs`。
- `requireAuth` で `X-Zhuelog-Act-As` を確かめる（上の 2）。`Auth` インターフェースに `ActAs`。
- `GET /v1/me` の応答に `actingAs`。
- LINE の連携の 3 ルートを、なりすまし中は `403`（`notActing` のようなミドルウェア）。
- エラーの文言を `respond.go` に足す。
- VuePress（`docs-site/`）：`guide/auth.md` に「会員として操作」の節、`reference/auth.md` の `GET /v1/me`、`reference/line.md`、`errors.md`。

## Web の変更

- `client.ts`：`CallerInit.actAs`、`GoMe.actingAs`。
- `session-cookies.ts`：`ACT_AS_COOKIE` と、その書き込み・消去。ログイン・ログアウトで消す（`go-api-session.ts`、GitHub の callback）。
- `authed.ts`・`GoApiCurrentUserProvider`・`/api/chat`：Cookie を読んでヘッダーに。
- `AuthenticatedUser.actingAs`・`actAsIgnored`。
- Server Action `startActingAs`・`stopActing`、管理画面のボタン、`layout.tsx` の帯。
- `docs/`（Web 側の説明があれば）。

## テスト

- Go：`ActAs`（admin・会員・ゲスト・形式違い・2 つ・空・存在しない会員）、`requireAuth` でなりすまし中のハンドラーに会員の `OwnerID` が渡ること、`ActorID`、`GET /v1/me` の `actingAs`、LINE の 3 ルートが `403`、ルート表の全ルートで会員がヘッダーを付けたら `403`。
- Web（Vitest）：`callerHeaders` がヘッダーを付ける、`GoApiCurrentUserProvider`（`actingAs` あり・Cookie ありで `actingAs` なし・`404` で付け直し）、`startActingAs`（admin 以外・形式違い・Go が認めない・成功）、`stopActing`、ログイン・ログアウトで Cookie が消える。
- e2e：admin が会員として会話ノートを保存すると、その会員の `ownerId` で保存されること（会話練習は OpenAI が要るので、e2e で動かせなければノートの保存で確かめる）。

## デプロイの順番

1. Go API を先にデプロイする（手動）。新しい Go は、ヘッダーが無ければ今までと同じに動く。
2. Web をデプロイする（main へのマージ）。上の 11 により、Go が古いままでも、記録が admin のものになったまま気づかない、ということは起きない。

## 範囲外

- 会話練習を会員に開放すること。
- admin が別の admin として操作すること。
- モバイルアプリの画面（ヘッダーを付ければ同じ API を使える）。
- なりすましの履歴を DB に残すこと（ログだけ）。
