# Go 廃止 段階 9b（会員の管理・パスワード変更）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理者の会員の管理（`GET`/`POST /v1/admin/accounts`、`POST /v1/admin/accounts/{id}/password`）と、会員が自分のパスワードを変える処理（`POST /v1/account/password`）を、Go API から Next.js に移す。Web がパスワードを scrypt でハッシュし、Prisma で `PasswordAccount` と `SignInThrottle` を直接読み書きする。Go の 4 つのルートと、それだけが使うコードを同じ PR で消す。Go のログイン（段階 11 まで残る）は、Web が書いたハッシュを確かめ、Web が上げた `sessionVersion` で古いセッションを断り続ける。

**Architecture:** 段階 4〜9a と同じ形にする。

- 入力の規則（ログイン ID・表示名・新しいパスワード・生成するかどうか）と試行回数の決まりは、I/O の無い純粋な関数として `src/domain/identity/password-account.ts` と `src/domain/identity/sign-in-throttle.ts` に置く。
- scrypt のハッシュは `src/infrastructure/security/scrypt-password-hasher.ts`（`scripts/lib/` から移す。e2e とローカルの種も同じものを使う）。Go が書いた golden ファイルで、Go と 1 バイトも違わないことを固定する。
- DB は `src/infrastructure/prisma/password-account-store.ts` と `src/infrastructure/prisma/sign-in-throttle-store.ts`（どちらも新規）。
- だれが何をできるかは `src/application/identity/member-accounts.ts`（管理者）と `src/application/identity/own-password.ts`（自分のパスワード）。
- 入れ物は新しい `src/composition/account-container.ts`（`memberAccounts`・`ownPassword`）。今の `memberAccounts`（Go のゲートウェイ）にある LINE の 4 つのメソッドは、`src/infrastructure/go-api/line-link-gateway.ts` と `src/composition/line-container.ts` の `lineLink` に分ける（段階 10 で消える）。
- 画面と文言は変えない。

**Tech Stack:** Next.js 16.4（Server Component、Server Actions、`redirect`、`revalidatePath`、`headers`、`unstable_rethrow`）、TypeScript、Prisma 7（`$queryRaw`、`Prisma.sql`）、`node:crypto` の `scrypt`、`node:test` + `tsx`、Playwright、Go の `testing`（golden ファイル）。依存は増やさない。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 9、決めたこと 5〜9。段階 11 のセッションの決まりは決めたこと 6）

**Go の今の動きの参照（必読）：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage9-go-reference.md`（以下「参照」）。この計画で使うのは §0、§4〜§8、§9〜§15 の 9b の部分。

**前の計画：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage9a-social.md`（フォロー・タイムライン・会員の一覧）。この計画は 9a の PR の上に重ねた、別の PR にする。9a の分割の理由は 9a の判断 1。

## 設計者の判断（コントローラーが確かめること）

1. **ハッシュが Go と同じことは、Go が書いた golden ファイルで固定する。** 段階 4 の FSRS と同じやり方。
   - Task 1 で `services/api/auth/password_golden_test.go` を足し、決まった salt で作ったハッシュと、`Verify` の答え（受け付けるもの・断るもの）を `tests/fixtures/scrypt-golden.json` に書き出す（`go test ./auth -run TestScryptGolden -update`）。ふだんの `go test` は、Go がそのファイルと同じ答えを出すことを確かめる。Web のテストは同じファイルを読み、同じ salt で同じ文字列を作り、同じものを受け付け・断ることを確かめる。
   - Go の `auth` パッケージはログインのため段階 11 まで残るので、そのあいだ両側からずれないことを確かめられる。9b で Go の `Hash` を消したあとも、golden のテストは `formatScryptHash` と `scrypt.Key`（`Warm` が使うので残る）でハッシュを作り直して比べる。
   - 形式は `scrypt:32768:8:1:<16 バイトの salt>:<64 バイトの鍵>`（パディングなしの base64url）。パスワードは正規化しない（UTF-8 のバイトのまま）。参照 §6。
2. **ハッシュの実装は 1 つにする。** `scripts/lib/scrypt-password-hasher.ts` を `src/infrastructure/security/scrypt-password-hasher.ts` に `git mv` し、e2e の `createMember` とローカルの種（`scripts/api-local-seed.ts`）もそれを import する。足すのは、決まった salt で作る `hashWithSalt`（golden のテスト用）、Go の `Simulate` にあたる `simulate`、Go の `GeneratePassword` にあたる `generatePassword`。
3. **セッションを切るのは、ハッシュと同じ 1 つの `UPDATE` で `"sessionVersion" = "sessionVersion" + 1` にすること。** `ApiRefreshToken` には書かない。Go の `Authenticate` と `Refresh` は毎回 `sessionVersion` を比べ、違えば 401 にし、refresh token の family ごと失効させる（参照 §7）。Web の `TokenCurrentUserProvider` も毎回比べる。だから Go の `SetPassword` と同じ 1 つの文で足りる。e2e で「Web が上げたあと、古い refresh token を Go が断る」ことを確かめる。
4. **自分のパスワードの変更は、確かめたハッシュのときだけ置き換える。** `UPDATE … WHERE "id" = … AND "passwordHash" = <確かめたハッシュ>`。Go は確かめてから書くまでのあいだに管理者が再設定しても上書きした。Web は 0 行なら「現在のパスワードが違う」と同じ答えにする。scrypt（約 0.1 秒）のあいだトランザクションを開けたままにしないための、比べて置き換える 1 つの文。管理者の再設定は Go と同じく無条件（`WHERE "id"`）で、0 行なら「アカウントが見つかりません。」。
5. **試行回数の数え方と表は Go と同じにする。** どちらも `SignInThrottle` の表を、Go と同じ 2 つの文（期限切れを 100 行まで消す、1 つの upsert で数える）で使う。
   - `password-change:<accountId>`：15 分で 5 回。成功したら消す。ログインには影響しない。
   - `route:auth:<client>`：1 分で 10 回。Go のログインのルートと**同じ鍵**を使うので、段階 11 まで Go のログインと同じ枠を共有する（今と同じ）。`<client>` は `clientAddress(await headers())`（Web が今 Go に送っている値と同じ）。
   - 数える順も Go と同じ：だれか → クライアントの枠 → 新しいパスワード → 確認 → アカウント → `password-change` の枠 → 今のパスワード。
6. **今のパスワードの失敗は、どれも 1 回の scrypt と同じ答えにする。** アカウントが無い・枠を超えた・空・128 文字（コードポイント）を超える・違う、のどれも「現在のパスワードが違うか、一時的にロックされています。」で、ハッシュの計算はちょうど 1 回（違うときは `verify`、ほかは `simulate`。`simulate` には先頭の 128 コードポイントだけを渡す）。参照 §5。
7. **入力の規則は domain に、JavaScript の `trim()`・`toLowerCase()`・`length` で書く。** Go の `jsstr` は Web の zod の規則を写したものなので（参照 §4）、JS で書けばそのまま同じになる。順は Go と同じ：作成はログイン ID → 表示名 → パスワード、再設定はパスワード → アカウントの ID。文言は presenter（`account-action-errors.ts`）に Go の文言のまま置く。
8. **だれができるかは Go と同じ。**
   - 会員の管理：`role === "admin"`（会員として操作している admin も。Go の `ActAs` は役割を admin のまま残す）。ほかは `AccountAdminForbiddenError`。
   - 自分のパスワード：`role === "member"`、`githubId` が `password:` で始まり `accountId` がある、デモでない。admin（操作中も）・FFPF ID の会員・デモ・ゲスト・未ログインは `"forbidden"`（今の画面と同じく「この操作を行う権限がありません。再度ログインしてください。」）。
   - 管理者がデモのアカウントや、操作中の会員のパスワードを再設定するのは、Go と同じく止めない（参照 §4）。
9. **scrypt を同時にいくつ回すかは、Node のスレッドプールに任せる。** `node:crypto` の非同期の `scrypt` は libuv のスレッドプール（既定 4 本）で動くので、1 つのインスタンスで同時に 4 つまで。Go のセマフォ（4）と同じ上限になる。`maxmem` は今の Node の実装と同じ 64 MiB。
10. **LINE の連携のメソッドを、別のゲートウェイに分ける。** 今の `createAccountGateway` には、会員の管理と LINE の連携が同居している（参照 §9）。会員の管理を消すと LINE だけが残るので、`line-link-gateway.ts`（`createLineLinkGateway`）と `line-container.ts`（`lineLink`）に移し、名前を中身に合わせる。動きは変えない。段階 10 でまとめて消える。
11. **Go は、この 4 つのルートのためだけのコードをすべて消す。** 参照 §12・§13 の 9b の部分。`Verify`・`Simulate`・`Warm`・`parseScryptHash`・`formatScryptHash`・定数（ログイン）、`NormalizeLoginID`（ログインと設定）、`FindPasswordAccountBy*`・`SessionVersion`（ログインとデモ）、`store/throttle.go`（ログインと LINE）、`notDemo`・`notForDemo`（LINE）、`pathValueMsg` 以外の respond の道具は残す。
12. **DB を使う確かめは e2e で行う。** 管理画面のエラー、作ったハッシュの形と Go のログイン、再設定と変更のあとの `sessionVersion` と Go の refresh、変更の試行回数、デモと操作中の admin は、e2e で画面と DB で確かめる。

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` で、使う Next.js の API（`01-app/01-getting-started/07-mutating-data.md` の Server Actions と `bind` した引数、`01-app/03-api-reference/04-functions/` の `headers.md`・`redirect.md`・`revalidatePath.md`・`unstable_rethrow.md`）を確かめる（`AGENTS.md`）。
- コメントは英語。画面の文言は変えない。依存を増やさない。
- Prisma を import してよいのは `src/infrastructure/prisma/` だけ。`node:crypto` は `src/infrastructure/` だけ。`src/application/` は domain だけを import し、`console` を使わない。`src/domain/` は domain のほかを import しない（`TextEncoder` のような JS の組み込みは使ってよい）。
- SQL はタグ付きテンプレート（`$queryRaw\`…\``・`Prisma.sql\`…\``）だけ。`$queryRawUnsafe`と文字列の連結は使わない。時刻は Go と同じく`CAST(${now} AS TIMESTAMP(3))` で渡す。
- ハッシュ（参照 §6）：`scrypt:32768:8:1:<salt>:<key>`、salt 16 バイト、鍵 64 バイト、パディングなしの base64url、パスワードは UTF-8 のまま。確かめるときは Go の `parseScryptHash` と同じものだけを受け付ける。生成するパスワードは 15 バイトの乱数の base64url（20 文字）。
- 入力（参照 §4・§5）：
  - ログイン ID：`trim()` → `toLowerCase()` → `^[a-z0-9._-]{3,32}$`。違えば「ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。」。
  - 表示名：`trim()` して `length` が 1〜50、NUL を含まない。違えば「表示名は1〜50文字にしてください。」。保存するのは trim したもの。
  - 新しいパスワード：`length`（UTF-16 の単位）が 12〜128、trim しない。違えば「パスワードは12〜128文字にしてください。」。管理者の欄は `trim()` して空なら生成する。
  - 確認が違えば「確認用のパスワードが一致しません。」。今のパスワードの失敗は「現在のパスワードが違うか、一時的にロックされています。」。ログイン ID の重複は「このログインIDはすでに使われています。」。再設定の相手が無ければ「アカウントが見つかりません。」。
- 書き込み：作成は `ON CONFLICT ("loginId") DO NOTHING RETURNING`（0 行なら重複）。再設定と変更は、ハッシュと `"sessionVersion" + 1` と `"updatedAt"` を 1 つの `UPDATE … RETURNING`（0 行なら無い／置き換え済み）。`now` は 1 回の処理で 1 度だけ読む。
- パスワード（平文）とハッシュは、ログにも戻り値の型の外にも出さない。ログは `PASSWORD_ACCOUNT_CREATE_FAILED`・`PASSWORD_ACCOUNT_RESET_FAILED`・`PASSWORD_CHANGE_FAILED`・`PASSWORD_CHANGE_RATE_LIMITED` などの決まったコードとエラーの名前だけ。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps`）。Go は `cd services/api && go vet ./... && go test ./...`（`store`・`demo` の DB のテストは開発用 DB（Docker）で）。
- `git commit` と `git push` は、サンドボックスの外で行う。

## Review Focus

1. **Web のハッシュを Go が確かめられるか。** 同じ salt で同じ文字列、同じものを受け付け・断る。→ Task 1 のテスト `hashes and verifies exactly as Go does (golden file)` と Go の `TestScryptGolden`、Task 4 の e2e `a created member signs in through Go with the password the web hashed`。
2. **再設定と変更で、すべてのセッションが切れるか。** `sessionVersion` が 1 つ上がり、古い refresh token を Go が 401 で断る。→ Task 2 の `setPasswordSql bumps the session in the same statement`、Task 4 の e2e `reset revokes existing member sessions`（足す確かめ）。
3. **今のパスワードの失敗が見分けられないか。** どれも同じ答えで、scrypt は 1 回。枠は `password-change:<id>` の 5 回／15 分と `route:auth:<client>` の 10 回／1 分。→ Task 3 の `every current-password failure costs one hash and says the same` と `the client's route limit comes first`、Task 4 の e2e `wrong current passwords lock the change for a while`。
4. **だれができるか。** 管理は admin（操作中も）、自分のパスワードはパスワードの会員だけ（デモ・admin・FFPF ID は不可）。→ Task 3 の `only admins manage accounts` と `who may change: password members only`、Task 4 の e2e。
5. **入力の規則と順が Go と同じか。** → Task 2 の `login ids, names and passwords follow Go's rules` と Task 3 の `create checks loginId, then name, then password, as Go did`、Task 4 の e2e `the admin's form errors are the same`。
6. **Go に残すものを消していないか。** `Verify`・`Simulate`・`Warm`・`NormalizeLoginID`・`FindPasswordAccountBy*`・`SessionVersion`・`ConsumeThrottle`・`ResetThrottle`・`notDemo`。→ Task 4 Step 1 の `go test ./...` と grep。

---

### Task 1: ハッシュを `src/` に移し、Go の golden ファイルで固定する

**Files:**

- Create: `services/api/auth/password_golden_test.go`（`-update` で書き出し、ふだんは比べる）
- Create: `tests/fixtures/scrypt-golden.json`（Go が書き出したもの）
- Move: `scripts/lib/scrypt-password-hasher.ts` → `src/infrastructure/security/scrypt-password-hasher.ts`（`git mv`、足す）
- Modify: `e2e/fixtures.ts:9`、`scripts/api-local-seed.ts:6`（import を直すだけ）、`services/api/auth/password.go:15-16`（コメントの Node の場所を新しいパスに）
- Test: `tests/scrypt-password-hasher.test.ts`（import を直し、足す）

**Interfaces:**

- golden ファイルの形：

  ```json
  {
    "params": {
      "n": 32768,
      "r": 8,
      "p": 1,
      "saltBytes": 16,
      "keyBytes": 64,
      "generatedBytes": 15
    },
    "hashes": [
      {
        "name": "…",
        "password": "…",
        "salt": "<base64url>",
        "hash": "scrypt:…"
      }
    ],
    "verify": [{ "name": "…", "password": "…", "hash": "…", "match": true }]
  }
  ```

- Go（`package auth`、`var update = flag.Bool("update", false, "rewrite the scrypt golden file the web's tests read")`、ファイルは `../../../tests/fixtures/scrypt-golden.json`）：
  - `hashes` の salt は `sha256("zhuelog-scrypt-golden:" + name)` の先頭 16 バイト。ハッシュは `formatScryptHash(salt, scrypt.Key([]byte(password), salt, scryptN, scryptR, scryptP, scryptKeyBytes))`。ケース：
    - `ascii`：`correct horse battery`
    - `spaces kept`：` keep spaces 1`
    - `japanese`：`パスワードは十二文字以上`
    - `emoji`：`😀😀😀😀😀😀`
    - `128 characters`：`a` を 128 個
    - `decomposed accent`：`étude-password`、`composed accent`：`étude-password`（正規化しないので 2 つのハッシュは違う）
    - `generated shape`：`AbCdEfGhIjKlMnOpQrSt`
  - `verify`（`match` は `(&PasswordVerifier{}).Verify` の答え。`ascii` のハッシュの部分を `s, k` とする）：
    - `wrong password`：`correct horse batterY` と `ascii` のハッシュ → `false`
    - `older parameters`：`scrypt:16384:8:2:<s>:<N=16384, r=8, p=2 で作った鍵>` と `correct horse battery` → `true`
    - `leading zeros in N`：`scrypt:032768:8:1:<s>:<k>` → `true`
    - `N above 32768`：`scrypt:65536:8:1:<s>:<k>` → `false`、`N not a power of two`：`scrypt:3:8:1:<s>:<k>` → `false`
    - `r above 8`：`…:32768:9:1:…` → `false`、`p above 4`：`…:32768:8:5:…` → `false`、`p zero`：`…:32768:8:0:…` → `false`
    - `padded salt`：`<s>==` → `false`、`salt with a foreign character`：`<s>!` → `false`、`empty salt`：salt が `""` → `false`
    - `short key`：鍵の先頭 63 バイトの base64url → `false`、`tampered key`：`<k>` の 1 文字目を別の base64url の文字にしたもの → `false`
    - `seven parts`：`ascii` のハッシュ + `:x` → `false`、`not scrypt`：`bcrypt$2b$10$abcdefghijklmnopqrstuv` → `false`、`demo marker`：`demo:no-password` → `false`
  - `TestScryptGolden`：上を組み立て、`hashes` のそれぞれで `Verify(password, hash) == true` と、`verify` のそれぞれで `Verify == match` を確かめてから、`json.MarshalIndent(…, "", "  ")` + 改行を、`-update` なら書き、そうでなければファイルと比べる（違えば「`go test ./auth -run TestScryptGolden -update` を実行し、Web のテストを確かめる」と出す。`review/golden_test.go:249-266` と同じ形）。
- Web（`src/infrastructure/security/scrypt-password-hasher.ts`。今の `parse`・`deriveKey` はそのまま）：

  ```ts
  // The parameters Go writes and the web writes (services/api/auth/password.go).
  export const SCRYPT_PARAMS = {
    n: 32768,
    r: 8,
    p: 1,
    saltBytes: 16,
    keyBytes: 64,
    generatedBytes: 15,
  } as const;
  // Pure apart from the computation: the hash of password with this salt, in
  // Go's format. hash() is this with a fresh random salt.
  export async function hashWithSalt(
    password: string,
    salt: Buffer,
  ): Promise<string>;
  // A password to hand out: 15 random bytes as unpadded base64url (20
  // characters). Go: GeneratePassword.
  export function generatePassword(): string;
  export class ScryptPasswordHasher {
    hash(password: string): Promise<string>;
    verify(password: string, passwordHash: string): Promise<boolean>;
    // Spends the work of one verify on a valid hash, for a failure that must
    // cost as much as a wrong password. Never throws. Go: Simulate.
    simulate(password: string): Promise<void>;
  }
  ```

  `simulate` は、初めて呼ばれたときに乱数のパスワードと salt でダミーのハッシュを 1 度だけ作り（Go の `Warm`）、それに対して `verify` する。

- [ ] **Step 1: Go の golden を書き出す。** `cd services/api && go test ./auth -run TestScryptGolden -update && go test ./auth -run TestScryptGolden` → 成功し、`tests/fixtures/scrypt-golden.json` ができる。中身の `hashes` が 8 件、`verify` が 16 件で、`match` が `true` なのは `older parameters` と `leading zeros in N` の 2 件だけであることを目で確かめる。
- [ ] **Step 2: Web の失敗するテストを書く。** `tests/scrypt-password-hasher.test.ts`（import を `../src/infrastructure/security/scrypt-password-hasher` に。今の 4 本は変えない）に足す：
  - `hashes and verifies exactly as Go does (golden file)`：ファイルを読み、`params` が `SCRYPT_PARAMS` と同じ。`hashes` のそれぞれで `await hashWithSalt(password, Buffer.from(salt, "base64url")) === hash` と `verify(password, hash) === true`。`verify` のそれぞれで `verify(password, hash) === match`（名前をメッセージに）。
  - `generatePassword is 20 base64url characters`：`/^[A-Za-z0-9_-]{20}$/` に合い、2 回で違う。
  - `simulate costs one scrypt and never throws`：`simulate("x")` と `simulate("")` が `undefined` で終わる。
- [ ] **Step 3: 失敗を確かめる。** `node --import tsx --test tests/scrypt-password-hasher.test.ts` → FAIL。
- [ ] **Step 4: 実装する。** `git mv` してから足す。`hash` は `hashWithSalt(password, randomBytes(16))`。`e2e/fixtures.ts` と `scripts/api-local-seed.ts` の import を新しいパスに。ファイルの先頭のコメントを「The password hash format Go verifies at sign-in (services/api/auth/password.go). The web writes every hash: admin accounts, own password changes, the e2e fixtures and the local seed.」に。
- [ ] **Step 5: 通ることを確かめる。** 同じコマンド、`pnpm typecheck`、`pnpm lint`、`cd services/api && gofmt -l . && go vet ./auth && go test ./auth` → PASS。
- [ ] **Step 6: コミット。** `test: パスワードのハッシュが Go と同じことを golden ファイルで固定する`

### Task 2: 入力の規則・試行回数・アカウントの表

**Files:**

- Create: `src/domain/identity/password-account.ts`、`src/domain/identity/sign-in-throttle.ts`、`src/domain/identity/member-account.ts`、`src/infrastructure/prisma/password-account-store.ts`、`src/infrastructure/prisma/sign-in-throttle-store.ts`
- Test: `tests/password-account.test.ts`、`tests/sign-in-throttle.test.ts`、`tests/password-account-store.test.ts`、`tests/sign-in-throttle-store.test.ts`（すべて新規。DB は使わない）

**Interfaces:**

- Produces:

  ```ts
  // src/domain/identity/member-account.ts (moved from the Go gateway)
  export type MemberAccount = {
    id: string;
    ownerId: string;
    loginId: string;
    displayName: string;
    createdAt: Date;
  };
  // The password to hand to the member once: the one the admin typed, or a
  // generated one when the field was left blank.
  export type IssuedPassword = {
    loginId: string;
    password: string;
    generated: boolean;
  };

  // src/domain/identity/password-account.ts
  // Go: NormalizeLoginID. trim(), toLowerCase(), then ^[a-z0-9._-]{3,32}$;
  // null when it does not match.
  export function normalizeLoginId(raw: string): string | null;
  // Go: ValidDisplayName. The trimmed name, 1..50 UTF-16 units, no NUL.
  export function normalizeDisplayName(raw: string): string | null;
  // Go: ValidNewPassword. 12..128 UTF-16 units, not trimmed.
  export function isValidNewPassword(password: string): boolean;
  // Go: resolvePassword. Blank after trim() means generate one.
  export type PasswordChoice =
    { generate: true } | { generate: false; password: string };
  export function choosePassword(raw: string): PasswordChoice | null;
  export type AccountInputError = "login-id" | "display-name" | "password";
  // Go: validateAccountInput. loginId, then displayName, then password.
  export function checkNewAccount(raw: {
    loginId: string;
    displayName: string;
    password: string;
  }):
    | {
        ok: true;
        loginId: string;
        displayName: string;
        password: PasswordChoice;
      }
    | { ok: false; error: AccountInputError };
  // Go: validID. Non-empty, at most 128 UTF-8 bytes, no NUL.
  export function isAccountIdShape(id: string): boolean;
  // Go: ChangePassword's check of the current password: non-empty and at
  // most 128 code points.
  export const CURRENT_PASSWORD_MAX_CODE_POINTS = 128;
  export function isPlausibleCurrentPassword(current: string): boolean;
  // The first n code points of s (what simulate may see).
  export function firstCodePoints(s: string, n: number): string;

  // src/domain/identity/sign-in-throttle.ts
  export type ThrottleRule = { limit: number; windowMs: number };
  // Go: maxFailuresPerLogin per throttleWindow on "password-change:<id>".
  export const PASSWORD_CHANGE_THROTTLE: ThrottleRule; // { limit: 5, windowMs: 900_000 }
  // Go: authRateLimit per authRateWindow on "route:auth:<client>", shared
  // with Go's sign-in routes until they move too.
  export const AUTH_ROUTE_THROTTLE: ThrottleRule; // { limit: 10, windowMs: 60_000 }
  export function passwordChangeThrottleKey(accountId: string): string; // "password-change:" + id
  export function authRouteThrottleKey(client: string): string; // "route:auth:" + client

  // src/infrastructure/prisma/password-account-store.ts
  // Pure: Go's CreatePasswordAccount, with the taken loginId as no row.
  export function createPasswordAccountSql(
    id: string,
    input: { loginId: string; displayName: string; passwordHash: string },
    now: Date,
  ): Prisma.Sql;
  // Pure: Go's SetPassword (the hash and the session version in one
  // statement), returning the loginId. With expectedHash, only while the
  // stored hash is still that one.
  export function setPasswordSql(
    id: string,
    passwordHash: string,
    now: Date,
    expectedHash?: string,
  ): Prisma.Sql;
  export function createPasswordAccountStore(
    db: () => PrismaClient,
    newAccountId?: () => string, // newId by default
  ): {
    // Every password account, oldest first (createdAt, id).
    list(): Promise<MemberAccount[]>;
    // null: the loginId is taken.
    create(
      input: { loginId: string; displayName: string; passwordHash: string },
      now: Date,
    ): Promise<MemberAccount | null>;
    loginIdOf(id: string): Promise<string | null>;
    credentials(
      id: string,
    ): Promise<{ id: string; passwordHash: string } | null>;
    // The loginId, or null when no account has the id.
    setPassword(
      id: string,
      passwordHash: string,
      now: Date,
    ): Promise<string | null>;
    // false: the account is gone or its hash is no longer expectedHash.
    replacePassword(
      id: string,
      expectedHash: string,
      passwordHash: string,
      now: Date,
    ): Promise<boolean>;
  };

  // src/infrastructure/prisma/sign-in-throttle-store.ts
  export const THROTTLE_PRUNE_BATCH = 100;
  // Pure: Go's prune of dead rows (store/throttle.go:21-26).
  export function pruneThrottleSql(now: Date): Prisma.Sql;
  // Pure: Go's one-statement count (store/throttle.go:32-38).
  export function consumeThrottleSql(
    key: string,
    now: Date,
    expiresAt: Date,
  ): Prisma.Sql;
  export function createSignInThrottleStore(db: () => PrismaClient): {
    // Counts one attempt; true while the count is within rule.limit.
    consume(key: string, rule: ThrottleRule, now: Date): Promise<boolean>;
    reset(key: string): Promise<void>;
  };
  ```

- SQL（Go と同じ。`$n` は差し込みの順）：

  ```sql
  -- createPasswordAccountSql
  INSERT INTO "PasswordAccount" ("id", "loginId", "displayName", "passwordHash", "sessionVersion", "createdAt", "updatedAt")
  VALUES (${id}, ${loginId}, ${displayName}, ${passwordHash}, 0, CAST(${now} AS TIMESTAMP(3)), CAST(${now} AS TIMESTAMP(3)))
  ON CONFLICT ("loginId") DO NOTHING
  RETURNING "id", "loginId", "displayName", "createdAt"

  -- setPasswordSql (the last line only with expectedHash)
  UPDATE "PasswordAccount" SET
    "passwordHash" = ${passwordHash},
    "sessionVersion" = "sessionVersion" + 1,
    "updatedAt" = CAST(${now} AS TIMESTAMP(3))
  WHERE "id" = ${id}
    AND "passwordHash" = ${expectedHash}
  RETURNING "loginId"

  -- pruneThrottleSql
  DELETE FROM "SignInThrottle" WHERE "key" IN (
    SELECT "key" FROM "SignInThrottle"
     WHERE "expiresAt" <= CAST(${now} AS TIMESTAMP(3))
     LIMIT ${THROTTLE_PRUNE_BATCH} FOR UPDATE SKIP LOCKED)

  -- consumeThrottleSql
  INSERT INTO "SignInThrottle" ("key", "count", "expiresAt")
  VALUES (${key}, 1, CAST(${expiresAt} AS TIMESTAMP(3)))
  ON CONFLICT ("key") DO UPDATE SET
    "count" = CASE WHEN "SignInThrottle"."expiresAt" <= CAST(${now} AS TIMESTAMP(3)) THEN 1 ELSE "SignInThrottle"."count" + 1 END,
    "expiresAt" = CASE WHEN "SignInThrottle"."expiresAt" <= CAST(${now} AS TIMESTAMP(3)) THEN CAST(${expiresAt} AS TIMESTAMP(3)) ELSE "SignInThrottle"."expiresAt" END
  RETURNING "count"
  ```

- [ ] **Step 1: 失敗するテストを書く。**（store のテストは `tests/review-store.test.ts:60` と同じく、空白をつぶした `sql.sql` と `sql.values` を見る）
  - `tests/password-account.test.ts`（Go の `auth/validate_test.go` と `TestAdminCreateAccount*` の表を写す）：
    - `login ids, names and passwords follow Go's rules`：
      - `normalizeLoginId`：`"alice"` → `"alice"`、`"  Alice.W_9-x "` → `"alice.w_9-x"`、`"﻿alice　"` → `"alice"`、`"Kabc"` → `"kabc"`、`"a.-"` → `"a.-"`、`"z".repeat(32)` → そのまま。`null`：`"\u0085alice"`、`"İabc"`、`"ab"`、`"z".repeat(33)`、`"al ice"`、`""`、`"あいう"`。
      - `normalizeDisplayName`：`"  Alice  "` → `"Alice"`、`"あ".repeat(50)`・`"😀".repeat(25)` → そのまま。`null`：`"あ".repeat(51)`、`"😀".repeat(26)`、`" \t　"`、`"a\u0000b"`。
      - `isValidNewPassword`：`true` は `"123456789012"`、`"a".repeat(128)`、`"あ".repeat(12)`、`"😀".repeat(6)`、`"😀".repeat(64)`、`"   spaces   "`。`false` は `"12345678901"`、`"a".repeat(129)`、`"あ".repeat(11)`、`"😀".repeat(65)`、`""`、`" eleven run"`。
      - `choosePassword`：`""`・`"   \t "` → `{ generate: true }`、`"  keep spaces 1 "` → `{ generate: false, password: "  keep spaces 1 " }`、`"short"` → `null`。
    - `checkNewAccount checks loginId, then name, then password`：`{ "ab", "x", "" }` → `login-id`、`{ "!", "", "x" }` → `login-id`、`{ "abc", "   ", "" }` → `display-name`、`{ "abc", "", "x" }` → `display-name`、`{ "abc", "x", "12345678901" }` → `password`、`{ "  Alice.W ", "  Alice  ", "" }` → `{ ok: true, loginId: "alice.w", displayName: "Alice", password: { generate: true } }`。
    - `account ids and current passwords are checked like Go`：`isAccountIdShape`：`"cx"` と `"a".repeat(128)` は `true`、`""`・`"a".repeat(129)`・`"あ".repeat(43)`（129 バイト）・`"a\u0000b"` は `false`。`isPlausibleCurrentPassword`：`"x"`・`"パ".repeat(128)` は `true`、`""`・`"x".repeat(129)`・`"パ".repeat(129)` は `false`。`firstCodePoints("😀".repeat(130), 128)` が `"😀".repeat(128)`。
  - `tests/sign-in-throttle.test.ts`：`PASSWORD_CHANGE_THROTTLE` が `{ limit: 5, windowMs: 900000 }`、`AUTH_ROUTE_THROTTLE` が `{ limit: 10, windowMs: 60000 }`、`passwordChangeThrottleKey("cacc1") === "password-change:cacc1"`、`authRouteThrottleKey("203.0.113.7") === "route:auth:203.0.113.7"`。
  - `tests/password-account-store.test.ts`：`now = new Date("2026-11-17T03:00:00.000Z")`。
    - `createPasswordAccountSql treats a taken loginId as no row`：文が `INSERT INTO "PasswordAccount"`、`0, CAST($5 AS TIMESTAMP(3)), CAST($6 AS TIMESTAMP(3))`、`ON CONFLICT ("loginId") DO NOTHING`、`RETURNING "id", "loginId", "displayName", "createdAt"` を含む。値は `["cid", "alice", "Alice", "scrypt:x", now, now]`。
    - `setPasswordSql bumps the session in the same statement`：`setPasswordSql("cx", "scrypt:new", now)` の文が `"passwordHash" = $1`、`"sessionVersion" = "sessionVersion" + 1`、`"updatedAt" = CAST($2 AS TIMESTAMP(3))`、`WHERE "id" = $3`、`RETURNING "loginId"` を含み、`AND "passwordHash"` を含まない。値は `["scrypt:new", now, "cx"]`。`setPasswordSql("cx", "scrypt:new", now, "scrypt:old")` は `AND "passwordHash" = $4` を含み、値の最後が `"scrypt:old"`。
  - `tests/sign-in-throttle-store.test.ts`：
    - `pruneThrottleSql deletes at most 100 dead rows without waiting`：文が `"expiresAt" <= CAST($1 AS TIMESTAMP(3))`、`LIMIT $2 FOR UPDATE SKIP LOCKED` を含み、値は `[now, 100]`。
    - `consumeThrottleSql counts in one statement as Go did`：`consumeThrottleSql("password-change:cacc1", now, new Date("2026-11-17T03:15:00.000Z"))` の文が `ON CONFLICT ("key") DO UPDATE SET`、`THEN 1 ELSE "SignInThrottle"."count" + 1 END`、`RETURNING "count"` を含み、値は `["password-change:cacc1", expiresAt, now, now, expiresAt]`（差し込みの順）。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/password-account.test.ts tests/sign-in-throttle.test.ts tests/password-account-store.test.ts tests/sign-in-throttle-store.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - `list`：`passwordAccount.findMany({ select: { id, loginId, displayName, createdAt }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })`、`ownerId` は `"password:" + id`。
  - `create`：`$queryRaw<Row[]>(createPasswordAccountSql(newAccountId(), …))`、0 行なら `null`。
  - `loginIdOf`・`credentials`：`findUnique({ where: { id }, select: … })`。
  - `setPassword`：`$queryRaw<{ loginId: string }[]>(setPasswordSql(…))[0]?.loginId ?? null`。`replacePassword`：同じ文に `expectedHash`、1 行なら `true`。
  - `consume`：`pruneThrottleSql(now)` を流してから `consumeThrottleSql(key, now, new Date(now.getTime() + rule.windowMs))`、`Number(count) <= rule.limit`。`reset`：`signInThrottle.deleteMany({ where: { key } })`。
  - 先頭のコメントに、Go のどの文と同じか（参照 §4・§8）、`sessionVersion` を同じ文で上げるわけ（判断 3）、比べて置き換えるわけ（判断 4）を書く。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドと `pnpm typecheck`・`pnpm lint` → PASS。
- [ ] **Step 5: コミット。** `feat(web): 会員のアカウントとパスワードの試行回数を Prisma で読み書きする`

### Task 3: application・container・画面を差し替える

**Files:**

- Create: `src/application/identity/member-accounts.ts`、`src/application/identity/own-password.ts`、`src/composition/account-container.ts`、`src/infrastructure/go-api/line-link-gateway.ts`、`src/composition/line-container.ts`
- Modify: `src/composition/identity-container.ts`（`memberAccounts` と `createAccountGateway` の import を消す）、`src/composition/record-owner-options.ts`、`src/app/admin/accounts/page.tsx`、`src/presentation/actions/password-account-actions.ts`、`src/presentation/presenters/account-action-errors.ts`、`src/presentation/controllers/action-state.ts`、`src/app/account/line/page.tsx`、`src/presentation/actions/line-link-actions.ts`
- Move: `tests/go-api-account-gateway.test.ts` → `tests/go-api-line-link-gateway.test.ts`（LINE の 8 本だけを残す）
- Delete: `src/infrastructure/go-api/account-gateway.ts`
- Test: `tests/member-accounts.test.ts`、`tests/own-password.test.ts`、`tests/account-action-errors.test.ts`（すべて新規）

**Interfaces:**

- Consumes: Task 1 の `ScryptPasswordHasher`・`generatePassword`、Task 2 のすべて、`getCachedCurrentUser`、`prisma()`、`clientAddress`。
- Produces:

  ```ts
  // member-accounts.ts
  // Only admins manage member accounts (an admin acting as a member too).
  export class AccountAdminForbiddenError extends Error {
    override name = "AccountAdminForbiddenError";
  }
  export type CreateAccountResult =
    | { ok: true; issued: IssuedPassword }
    | { ok: false; reason: AccountInputError | "login-id-taken" };
  export type ResetPasswordResult =
    | { ok: true; issued: IssuedPassword }
    | { ok: false; reason: "password" | "not-found" };
  export type MemberAccountsDeps = {
    currentUser: () => Promise<AuthenticatedUser | null>;
    store: {
      list(): Promise<MemberAccount[]>;
      create(input: { loginId: string; displayName: string; passwordHash: string }, now: Date): Promise<MemberAccount | null>;
      loginIdOf(id: string): Promise<string | null>;
      setPassword(id: string, passwordHash: string, now: Date): Promise<string | null>;
    };
    hashPassword: (password: string) => Promise<string>;
    generatePassword: () => string;
    now: () => Date;
  };
  export function createMemberAccounts(deps: MemberAccountsDeps): {
    list(): Promise<MemberAccount[]>;
    create(raw: { loginId: string; displayName: string; password: string }): Promise<CreateAccountResult>;
    resetPassword(accountId: string, rawPassword: string): Promise<ResetPasswordResult>;
  };

  // own-password.ts
  export type ChangePasswordOutcome =
    | "changed" | "forbidden" | "rate-limited"
    | "invalid-new-password" | "password-mismatch" | "invalid-current-password";
  export type OwnPasswordDeps = {
    currentUser: () => Promise<AuthenticatedUser | null>;
    accounts: {
      credentials(id: string): Promise<{ id: string; passwordHash: string } | null>;
      replacePassword(id: string, expectedHash: string, passwordHash: string, now: Date): Promise<boolean>;
    };
    passwords: {
      hash(password: string): Promise<string>;
      verify(password: string, passwordHash: string): Promise<boolean>;
      simulate(password: string): Promise<void>;
    };
    throttle: {
      consume(key: string, rule: ThrottleRule, now: Date): Promise<boolean>;
      reset(key: string): Promise<void>;
    };
    now: () => Date;
  };
  export function createOwnPassword(deps: OwnPasswordDeps): {
    change(
      input: { currentPassword: string; newPassword: string; confirmPassword: string },
      client: string,
    ): Promise<ChangePasswordOutcome>;
  };

  // account-action-errors.ts (the two existing exports stay)
  export function accountInputMessage(reason: AccountInputError | "login-id-taken"): string;
  // The form's text for each outcome but "changed".
  export function changePasswordMessage(outcome: Exclude<ChangePasswordOutcome, "changed">): string;

  // line-link-gateway.ts: getLineLink, setLineReviewNotify, issueLineLinkCode,
  // unlinkLine moved verbatim from account-gateway.ts.
  export function createLineLinkGateway(call?: GoApiCall): { … };
  // line-container.ts
  export const lineLink = createLineLinkGateway();
  ```

  決まり：
  - `member-accounts`：どのメソッドも最初に `user?.role === "admin"`、違えば `AccountAdminForbiddenError`（判断 8）。
    - `create`：`checkNewAccount` が失敗 → `{ ok: false, reason: error }`（ハッシュも store も呼ばない）→ 生成なら `generatePassword()` → `hashPassword` → `store.create(…, now())` が `null` → `"login-id-taken"` → `{ ok: true, issued: { loginId: 作った行の loginId, password, generated } }`。
    - `resetPassword`：`choosePassword` が `null` → `"password"`（参照 §4：パスワードが先）→ `isAccountIdShape` でない → `"not-found"` → `store.loginIdOf` が `null` → `"not-found"`（ハッシュしない）→ `hashPassword` → `store.setPassword(…, now())` が `null` → `"not-found"` → `{ ok: true, issued: { loginId: setPassword の答え, password, generated } }`。
  - `own-password` の `change`（判断 5・6・8。`now` は最初に 1 度だけ読む）：
    1. `user?.role !== "member"`・`user.demo === true`・`githubId` が `password:` で始まらない・`accountId` が無い → `"forbidden"`（何も数えない）。
    2. `throttle.consume(authRouteThrottleKey(client), AUTH_ROUTE_THROTTLE, now)` が `false` → `"rate-limited"`。
    3. `isValidNewPassword(newPassword)` でない → `"invalid-new-password"`。4. `newPassword !== confirmPassword` → `"password-mismatch"`。
    4. `accounts.credentials(accountId)` が `null` → `passwords.simulate(firstCodePoints(currentPassword, 128))` → `"invalid-current-password"`。
    5. `throttle.consume(passwordChangeThrottleKey(id), PASSWORD_CHANGE_THROTTLE, now)` が `false`、または `isPlausibleCurrentPassword(currentPassword)` でない → `simulate(firstCodePoints(…))` → `"invalid-current-password"`。
    6. `passwords.verify(currentPassword, hash)` が `false` → `"invalid-current-password"`。
    7. `passwords.hash(newPassword)` → `accounts.replacePassword(id, hash, newHash, now)` が `false` → `"invalid-current-password"`。
    8. `throttle.reset(passwordChangeThrottleKey(id))` → `"changed"`。

- [ ] **Step 1: 失敗するテストを書く。**（利用者は `tests/practice-records.test.ts:23-45` を写す。会員は `{ githubLogin: "alice", githubId: "password:cacc1", role: "member", accountId: "cacc1" }`、admin は `{ githubLogin: "octocat", githubId: "10001", role: "admin" }`、FFPF ID の会員は `{ githubLogin: "f@example.com", githubId: "ffpf:cabc", role: "member" }`。ハッシュの偽物は `hash(p) = "hash:" + p`、`verify(p, h) = h === "hash:" + p`、計算の回数を数える。`now = new Date("2026-11-17T03:00:00.000Z")`）
  - `tests/member-accounts.test.ts`：
    - `only admins manage accounts`：admin・会員として操作している admin は `list` が store の答えを返す。会員・デモ・ゲスト・`null`・`revoked` は 3 つのメソッドのどれも `AccountAdminForbiddenError`、store とハッシュは呼ばれない。
    - `create checks loginId, then name, then password, as Go did`：Task 2 の `checkNewAccount` の表の 5 つの失敗がそのまま `reason` になり、ハッシュと store は呼ばれない。
    - `create stores the trimmed account with the hash of the password it hands out`：
      - `{ "  Alice.W ", "  Alice  ", "" }`、`generatePassword` が `"GENERATEDpassword123"` → store に `({ loginId: "alice.w", displayName: "Alice", passwordHash: "hash:GENERATEDpassword123" }, now)`、答えは `{ ok: true, issued: { loginId: "alice.w", password: "GENERATEDpassword123", generated: true } }`。
      - パスワード `"  keep spaces 1 "` → そのまま、`generated: false`。`"   \t "` → 生成。
      - store の `create` が `null` → `{ ok: false, reason: "login-id-taken" }`。
    - `reset checks the password before the account and hashes nothing for a missing one`：
      - `("missing", "short")` → `"password"`、`loginIdOf` は呼ばれない。
      - `("", "")`・`("a\u0000b", "")` → `"not-found"`、store は呼ばれない。`loginIdOf` が `null` → `"not-found"`、ハッシュは 0 回。
      - `loginIdOf` が `"alice"`、`setPassword` が `"alice"` → store に `("cx", "hash:a brand new pw", now)`、答えは `{ ok: true, issued: { loginId: "alice", password: "a brand new pw", generated: false } }`。`setPassword` が `null` → `"not-found"`。
  - `tests/own-password.test.ts`（Go の `password_change_test.go` を写す。アカウントは `{ id: "cacc1", passwordHash: "hash:correct horse" }`、`client = "203.0.113.7"`、throttle の偽物は鍵ごとの数を持ち、呼び出しを記録する）：
    - `who may change: password members only`：admin・会員として操作している admin・FFPF ID の会員・デモ・ゲスト・`null`・`revoked`・`accountId` の無い会員 → `"forbidden"`、throttle・アカウント・ハッシュのどれも呼ばれない。
    - `the client's route limit comes first`：`route:auth:203.0.113.7` が 10 回に達している → `"rate-limited"`、アカウントもハッシュも呼ばれず、`password-change:cacc1` は数えない。ほかのすべての呼び出しで、最初の `consume` は `("route:auth:203.0.113.7", { limit: 10, windowMs: 60000 }, now)`。
    - `the new password is checked before anything about the current one`：`newPassword`/`confirmPassword` が `"elevenchars"`/同じ・`""`/`""`・`"x".repeat(129)`/同じ・`"elevenchars"`/`"other"` → `"invalid-new-password"`。今が `"wrong"` で `"elevenchars"` → `"invalid-new-password"`。`"new-password"`/`"new-passwordx"` → `"password-mismatch"`。今が `""` で不一致 → `"password-mismatch"`。どれも、アカウントを読まず、ハッシュ・verify・simulate は 0 回、`password-change:cacc1` は数えない。
    - `new passwords count UTF-16 units and keep spaces`：`"パ".repeat(12)`・`"x".repeat(128)`・`"パ".repeat(128)`・`"  leading sp"`・`"😀".repeat(6)` → `"changed"`、置き換えたハッシュは `"hash:" + そのまま`。`"😀".repeat(65)`・`" eleven run"` → `"invalid-new-password"`。
    - `every current-password failure costs one hash and says the same`：
      - アカウントが無い → `simulate` 1 回、`password-change:cacc1` は数えない。
      - 今が `""`・`"x".repeat(129)`・`"パ".repeat(129)` → `consume` されて `simulate` 1 回（渡るのは先頭 128 コードポイント）。
      - `password-change:cacc1` がすでに 5 → `consume` されて `simulate` 1 回。
      - 今が `"wrong"` → `consume` されて `verify` 1 回、`simulate` 0 回。
      - どれも `"invalid-current-password"`、`hash`・`replacePassword`・`reset` は呼ばれず、verify と simulate の合計がちょうど 1 回。
    - `a change replaces the verified hash and bumps the session`：呼び出しの順が `consume(route)`、`credentials("cacc1")`、`consume("password-change:cacc1", { limit: 5, windowMs: 900000 }, now)`、`verify`、`hash("new-password")`、`replacePassword("cacc1", "hash:correct horse", "hash:new-password", now)`、`reset("password-change:cacc1")`、答えは `"changed"`。
    - `a hash replaced meanwhile is a wrong current password`：`replacePassword` が `false` → `"invalid-current-password"`、`reset` は呼ばれない。
  - `tests/account-action-errors.test.ts`：`accountInputMessage` の `login-id`・`display-name`・`password`・`login-id-taken` が Go の 4 つの文言（Global Constraints）。`changePasswordMessage` の `forbidden` が `accountForbiddenMessage`、`rate-limited` が `genericErrorMessage`、`invalid-new-password`・`password-mismatch`・`invalid-current-password` が Go の文言。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/member-accounts.test.ts tests/own-password.test.ts tests/account-action-errors.test.ts` → FAIL。
- [ ] **Step 3: 実装してつなぎ替える。**
  - `account-container.ts`：

    ```ts
    const passwords = new ScryptPasswordHasher();
    const accounts = createPasswordAccountStore(prisma);
    // Member accounts (admins only), read and written in the database.
    export const memberAccounts = createMemberAccounts({
      currentUser: getCachedCurrentUser,
      store: accounts,
      hashPassword: (password) => passwords.hash(password),
      generatePassword,
      now: () => new Date(),
    });
    // A member's own password change, counted in SignInThrottle like Go's
    // sign-in.
    export const ownPassword = createOwnPassword({
      currentUser: getCachedCurrentUser,
      accounts,
      passwords,
      throttle: createSignInThrottleStore(prisma),
      now: () => new Date(),
    });
    ```

  - `/admin/accounts` と `record-owner-options.ts`：`memberAccounts.listAccounts()` を `memberAccounts.list()`（`@/composition/account-container`）に。ほかは変えない。
  - `password-account-actions.ts`：
    - 作成：`attemptAccountCall("PASSWORD_ACCOUNT_CREATE_FAILED", () => memberAccounts.create({ loginId, displayName, password }))`。`ok: false` → `{ status: "error", message: accountInputMessage(reason) }`。成功は今と同じ（`refreshAccountList` と `{ status: "success", ...issued }`）。
    - 再設定：`"password"` → `accountInputMessage("password")`、`"not-found"` → `accountNotFoundMessage`。
    - 変更：`getCurrentMemberUser` の確かめは残す。`ownPassword.change(…, clientAddress(await headers()))` を `attemptAccountCall("PASSWORD_CHANGE_FAILED", …)` で。`"rate-limited"` のときは `console.error("PASSWORD_CHANGE_RATE_LIMITED")`。`"changed"` 以外は `{ status: "error", message: changePasswordMessage(outcome) }`。`"changed"` は今と同じく `signOutViaGo("/signin?notice=password-changed")`（Go のログアウトが refresh token の family を失効させる。段階 11 まで）。
    - 「Turns a failed Go call…」などのコメントを、DB の処理に合わせて直す。
  - `account-action-errors.ts`：Go の文言を定数で置き、2 つの関数を足す。先頭のコメントの「Go answers 404 …」を、Web が決める文言だと書き直す。
  - `action-state.ts`：`isForbidden` に `AccountAdminForbiddenError` を足す。`userFacingCodes` から `password_mismatch`・`invalid_current_password`・`login_id_taken` を消す（Go がもう返さない）。コメントの例の列を直す。
  - LINE の分割（判断 10）：`account-gateway.ts` の LINE の 4 つのメソッドを `line-link-gateway.ts` に（コメントごと）移し、`line-container.ts` に `lineLink`（コメント「LINE linking still goes through the Go API as the signed-in user (stage 10).」）。`/account/line` と `line-link-actions.ts` の `memberAccounts.*` を `lineLink.*` に。`account-gateway.ts` を消す。テストのファイルを `git mv` し、会員の管理の 7 本を消して import を直す。
- [ ] **Step 4: 確かめる。**
  - `pnpm typecheck && pnpm lint && node --import tsx --test tests/*.test.ts` → PASS（`tests/architecture.test.ts` を含む）。
  - `grep -rn "account-gateway\|createAccountGateway\|/v1/admin/accounts\|/v1/account/password\|listAccounts\|changeOwnPassword(" src tests` → 何も出ない。`grep -rn "scripts/lib/scrypt" . --include='*.ts' --exclude-dir=node_modules` → 何も出ない。
- [ ] **Step 5: コミット。** `refactor(web): 会員の管理とパスワード変更を Go に頼まずに行う`

### Task 4: Go の 4 つのルートを消し、e2e で確かめる

**Files:**

- Delete / Modify（参照 §12・§13・§14 の 9b の部分に従う）：
  - 消す：`httpapi/admin_handlers.go`、`httpapi/admin_handlers_test.go`、`httpapi/account_handlers.go`、`httpapi/account_handlers_test.go`、`httpapi/validate.go`、`auth/password_change.go`、`auth/password_change_test.go`。
  - `httpapi/router.go`：`Accounts`（:51-58）、`_ Accounts`・`_ PasswordHasher`（:20-21）、`Auth.ChangePassword`（:32）、`Deps.Accounts`・`Deps.Hasher` とそのコメント（:76-78）、`adminOnly`（:197-198）、`r.accountRoutes()`・`r.adminRoutes()` と 2 つの関数を消す。`notForDemoWrapped` を `notForDemo` に畳む（`r.handle(route{…, closedToDemo: true}, r.authed(notDemo(r.d.Auth, h)))`）。
  - `httpapi/respond.go`：`msgAdminOnly`・`msgMembersOnly`・`msgInvalidNewPassword`・`msgPasswordMismatch`・`msgInvalidCurrentPassword`・`msgInvalidLoginID`・`msgInvalidName`・`msgLoginIDTaken`・`msgAccountNotFound`、`codePasswordMismatch`・`codeInvalidCurrentPassword`・`codeLoginIDTaken`、`writeServiceError` の `ErrInvalidNewPassword`・`ErrPasswordMismatch`・`ErrInvalidCurrentPassword` の 3 つの case、`pathValueMsg` を消す。
  - `httpapi/testutil_test.go`：`fakeAuth.changePass` と `ChangePassword` を消す。
  - `auth/service.go`：`Store.SetPassword`（:51）と `Hasher.Hash`（:84）を消し、`Service` のコメントの「and members' own password changes」「ChangePassword's sentinels」を消す。
  - `auth/password.go`：`Hash`（:170-185）と `GeneratePassword`（:197-201）を消す（`formatScryptHash`・`generatedBytes` は `Warm` が使うので残す）。コメントの「PasswordVerifier checks passwords against the web app's scrypt hashes」はそのまま。
  - `auth/password_test.go`：`TestHashVerifiesAndMatchesFormat`・`TestHashSharesTheBoundAndRespectsContext`・`TestHashScryptFailure`・`TestGeneratePassword` を消す。
  - `auth/validate.go`：`ValidNewPassword`・`ValidDisplayName`・3 つの定数を消す（`NormalizeLoginID` は残す）。コメントの「The web app's password-account rules (src/domain/identity/entities/password-account.ts)」を「The web's loginId rule (src/domain/identity/password-account.ts normalizeLoginId); sign-in normalises with it.」に。`auth/validate_test.go`：`TestValidNewPassword`・`TestValidDisplayName` を消す。
  - `auth/helpers_test.go`：`fakeStore.SetPassword`・`setPasswordAt` と `fakeHasher.Hash`（と `hashes` が `Hash` だけのものなら）を消す。
  - `jsstr/jsstr.go`：`Len` を消し、`jsstr_test.go` の `TestLen` を消す。パッケージのコメントの「(trim, length, toLowerCase)」を「(trim, toLowerCase)」に。
  - `store/accounts.go`：`ErrLoginIDTaken`・`SetPassword`・`AccountSummary`・`ListPasswordAccounts`・`CreatePasswordAccount` と `pgconn` の import を消す。`store/accounts_test.go`：`TestSetPassword`・`TestCreateAndListPasswordAccounts`・`TestCreatePasswordAccountDuplicateLoginID` を消す。
  - `store/demo_test.go:230`：`s.CreatePasswordAccount(ctx, loginID, "試用", "scrypt:existing", fixedNow())` を、`id := newID()` と `INSERT INTO "PasswordAccount" ("id", "loginId", "displayName", "passwordHash", "sessionVersion", "createdAt", "updatedAt") VALUES ($1, $2, '試用', 'scrypt:existing', 0, $3, $3)` にし、`made.ID` を `id` に。
  - `main.go`：`Accounts: db,`・`Hasher: passwords,` を消す（`passwords` は `Service.Passwords` で使い続ける）。
  - `httpapi/demo_test.go`：`TestDemoIsRefusedExactlyTheClosedRoutes` の `want` から `POST /v1/account/password` を消す（LINE の 5 つだけが残る）。
- Modify（docs-site。段階 1〜9a と同じ扱い）：
  - `docs-site/reference/admin.md` を消し、`docs-site/.vuepress/config.ts:33` のナビから外す。
  - `docs-site/reference/auth.md`：3 行目の「と `POST /v1/account/password`」「（同じ枠を共有）」を消し、`## POST /v1/account/password`（:187）からその節の終わりまでを消す。
  - `docs-site/reference/README.md`：18 行（`POST /v1/account/password`）と 30〜32 行（admin の 3 つ）を消す。
  - `docs-site/errors.md`：38 行（「この操作は会員だけが利用できます。」）と、`password_mismatch`・`invalid_current_password`・`login_id_taken` の行、「管理者だけが利用できます。」の行を消す。47 行の 429 の説明から `/v1/account/password` を消す。
  - `docs-site/guide/auth.md`：52 行の FFPF ID と `POST /v1/account/password` の文を「パスワードは portal で変えます」だけに、164〜165 行（失効の理由）を「Web で会員が自分のパスワードを変えたとき」「Web の管理画面で admin が会員のパスワードを再設定したとき」に（どちらも `sessionVersion` が上がる）、178 行の箇条を消し、203 行の段落を「自分のパスワードの変更（Web）にも、アカウントごとに 15 分で 5 回までの制限があります。同じ `SignInThrottle` の表で数え、ログインには影響しません。」にする。
- Modify：`e2e/accounts.spec.ts`、`e2e/demo.spec.ts`、`e2e/act-as.spec.ts`。

- [ ] **Step 1: Go を消す。**
  - `cd services/api && gofmt -l . && go vet ./... && go build ./... && go test ./...` → 成功（`store`・`demo` の DB のテストは開発用 DB（Docker）で）。`TestScryptGolden` も通る。
  - `grep -rn "ChangePassword\|ListPasswordAccounts\|CreatePasswordAccount\|AccountSummary\|ErrLoginIDTaken\|SetPassword\|GeneratePassword\|ValidNewPassword\|ValidDisplayName\|msgAdminOnly\|msgMembersOnly\|login_id_taken\|password_mismatch\|invalid_current_password\|adminOnly\|requireAdmin\|/v1/admin/accounts\|/v1/account/password\|jsstr.Len\|\.Hash(" services/api scripts` → 何も出ない。
  - `grep -rn "func (v \*PasswordVerifier) \(Verify\|Simulate\|Warm\)\|func NormalizeLoginID\|func (s \*Store) \(FindPasswordAccountByID\|SessionVersion\|ConsumeThrottle\|ResetThrottle\)\|func notDemo" services/api` で、それぞれ 1 つずつ残る。
- [ ] **Step 2: 足りない e2e を足す（判断 12）。**
  - `e2e/accounts.spec.ts`：
    - `the admin's form errors are the same`：太郎（`taro`）を `createMember`。admin で `/admin/accounts`：
      - ログイン ID `ab`、表示名 `x` →「ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。」。
      - `hanako`、表示名 `   ` →「表示名は1〜50文字にしてください。」（入力の `required` は空白で通る）。
      - `hanako`、`花子`、パスワード `short` →「パスワードは12〜128文字にしてください。」。
      - `TARO`、`太郎2` →「このログインIDはすでに使われています。」。
      - `SELECT count(*) FROM "PasswordAccount"` は 1 のまま。
      - 太郎の行の再設定欄に `short` を入れて「パスワードを再設定」（`dialog` を accept）→「パスワードは12〜128文字にしてください。」、太郎の `sessionVersion` は 0 のまま。
    - `a created member signs in through Go with the password the web hashed`：admin で `loginId` ` Hanako`、表示名 `  花子  `、パスワード ` keep spaces 1` で作る → 出たパスワードは ` keep spaces 1`（`readOutputPassword` の正規表現は空白を含めないので、DB と画面の「ログインID: hanako」で確かめ、ログインは入力した文字列で行う）。DB：`loginId = 'hanako'`、`displayName = '花子'`、`"passwordHash"` が `/^scrypt:32768:8:1:[\w-]{22}:[\w-]{86}$/`、`"sessionVersion" = 0`。別のコンテキストで `asMember(page, "hanako", "  keep spaces 1 ", "/logs")` → 「日付別の学習ノート」が見える（Go のログインが Web のハッシュを受け付ける）。
    - `reset revokes existing member sessions`（今のテストに足す）：再設定の前に会員のコンテキストの `zl_refresh` を読む（`go-session.spec.ts:5-7` と同じ）。再設定のあと、`"sessionVersion"` が 1。`fetch(\`${goApiURL}/v1/auth/refresh\`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken }) })`が`401`（Go が Web の上げた `sessionVersion` を見て断る）。
    - `member changes own password`（今のテストに足す）：変更のあと、`"sessionVersion"` が 1、`"passwordHash"` が変わっている、`SELECT count(*) FROM "SignInThrottle" WHERE "key" = 'password-change:' || $1` が 0。
    - `wrong current passwords lock the change for a while`：太郎でログインして `/account/password`。今のパスワードを `wrong-password-N`（N = 1〜5）、新しいパスワード `member-password-2` で 5 回送る → 毎回「現在のパスワードが違うか、一時的にロックされています。」。6 回目は正しい今のパスワードでも同じ文言。DB：`password-change:<id>` の `count` が 6、`"sessionVersion"` は 0。別のコンテキストで `asMember(…, "taro", "member-password-1")` が通る（ログインは締め出さない）。
    - `mismatched and short new passwords are refused`：「新しいパスワード（確認）」だけ違う →「確認用のパスワードが一致しません。」、新しいパスワード `short` →「パスワードは12〜128文字にしてください。」。どちらも `SignInThrottle` に `password-change:` の行は無い。
  - `e2e/act-as.spec.ts` の最初のテスト（会員として操作中）に足す：`/account/password` を開くと `pathname === "/"`。
  - `e2e/demo.spec.ts` の `anyone can try the members' pages in the demo, without AI`、「デモを終える」の前：`/account/password` で 3 つの欄に入れて「パスワードを変更」→「この操作を行う権限がありません。再度ログインしてください。」（デモのアカウントの `passwordHash` は `demo:no-password` のまま）。
  - 既存の `e2e/accounts.spec.ts` の 6 本、`act-as.spec.ts`・`demo.spec.ts`・`ffpf-login.spec.ts`・`go-session.spec.ts`・`line.spec.ts`・`follow.spec.ts` は、ほかを変えずに通ること。
- [ ] **Step 3: 全体を確かめる。**
  - `docker ps` でほかの e2e がないことを確かめ、`pnpm test:regression` → PASS。
  - 終わったら `pnpm test:e2e:stop`。
- [ ] **Step 4: コミット。** `refactor: Go の会員の管理とパスワード変更のルートを消す`

### Task 5: ドキュメント

**Files:** `docs/api-deployment.md`、`docs/architecture.md`、`docs/features.md`、`docs/roadmap.md`、`docs/development.md`（あれば）、`README.md`、`docs-site/README.md`、`docs-site/operations/deploy.md`

段階 7・8・9a の学び：古い「Go が受け持つ」の記述が残りやすい。下の一覧のほかにも、`grep` で探してすべて直す。

- [ ] **Step 1: 直す。**
  - `README.md`：
    - 33 行（技術の表の API の行）：Go の受け持ちを「LINE、ログイン、定期実行」にし、括弧に「会員の管理・パスワード変更」を足す。
    - 34 行（DB の行）：「Go API はアカウントの書き込み（ログイン・refresh・管理）と…」を「Go API はログイン（refresh token とログインの試行回数）と LINE を受け持ち…」にし、Web が書くものに「会員のアカウント（作成・パスワードの再設定と変更）」を足す。
    - 35 行（認証）：「ID とパスワード（scrypt）」のあとに「（ハッシュは Web が書き、Go のログインが確かめる。同じ形であることを golden ファイルで確かめています）」を足す。
    - 42 行（「Web が DB に触るのは…」）：列に「会員の管理とパスワードの変更」を足し、本文にも書く。
  - `docs/architecture.md`：
    - 33 行の Web → DB の辺に「会員の管理・パスワード変更」を足し、43 行の箇条にも足す。
    - 92 行（ID とパスワードの表）：「パスワードは scrypt（N=2^15, r=8, p=1）。Web が `src/infrastructure/security/scrypt-password-hasher.ts` で書き、Go のログインが確かめる。`tests/fixtures/scrypt-golden.json`（Go の `password_golden_test.go` が書く）で両者が同じことを確かめる」にする。
    - 109 行（パスワード変更と `sessionVersion`）：管理者の再設定も同じこと、変更と再設定は Web が 1 つの `UPDATE` で行い、Go のログインと refresh も Web も次のリクエストで断ること、を書く。
    - 209 行（入力の検証が 2 か所）：会員の作成・パスワードの規則は Web（`src/domain/identity/password-account.ts`）だけになった。Go に残るのは、ログインのときのログイン ID の正規化（`NormalizeLoginID`、同じ規則）だけ、と書き直す。
  - `docs/features.md`：14 行（デモの使えないもの）：パスワード変更を Web が断る側に移す（Go が断るのは LINE 連携だけ）。パスワードの会員（アカウントの発行・再設定・自分での変更）の節があれば、Web が行い、変更は 15 分で 5 回までと書く（`grep -n "パスワード" docs/features.md` で探す）。
  - `docs/roadmap.md:28`：9a で書いた「移行中の Go API（ログイン・LINE・会員の管理）」から「・会員の管理」を外す。
  - `docs-site/README.md`：15 行・24 行・27 行・63 行から「会員の管理」を外し、Web が直接扱う列に「会員の管理（作成・パスワードの再設定）、自分のパスワードの変更」を足す。41 行の store のコメントから「アカウント」を「アカウントの読み取り」に。
  - `docs-site/operations/deploy.md` の「6」の節と `docs/api-deployment.md:112-130` が、Web が DB に書くものを並べていれば、会員のアカウントと `SignInThrottle`（パスワード変更の回数）を足す（段階 8 の fix wave で 2 つをそろえた。両方を同じにする）。
  - `docs/api-deployment.md`：
    - 451 行：「`POST /v1/account/password` は `403` です」を「`/account/password` には portal へのリンクだけを出します」に。
    - 470 行：デモに `POST /v1/account/password` を断るのは Web になった、と直す（Go の `IsDemo` が断るのは LINE 連携の 5 つだけ）。
    - 493 行（IP ごとのレート制限）：「`/v1/auth/*` と `POST /v1/account/password` で同じ枠を共有」を「`/v1/auth/*` で共有。Web のパスワード変更も同じ鍵（`route:auth:<IP>`）を `SignInThrottle` で数えるので、同じ枠に入ります」に。
    - 517 行の「DB の接続数とパスワードの計算」の節：パスワードのハッシュ（作成・再設定・変更）は Web の関数で計算する（1 回 32 MiB、同時に 4 つまで）と足す。
    - 「段階9a（…）のマージの前と後」のあとに、「段階9b（会員の管理・パスワード変更）のマージの前と後」を足す（段階 8・9a と同じ形）：
      - はじめの段落：会員の作成・一覧・パスワードの再設定（管理者）と、自分のパスワードの変更を Web に移した変更。Web が scrypt で Go と同じ形のハッシュを書き（golden ファイルで確かめる）、ハッシュと `sessionVersion` を 1 つの `UPDATE` で変える。Go の `/v1/admin/accounts`・`/v1/admin/accounts/{id}/password`・`/v1/account/password` はなくなった。Go に残るのは、LINE、ログイン（ハッシュの確かめと `sessionVersion` の確かめを含む）、Cron。
      - マージの前：この段階で必須の環境変数も、マイグレーションもない（`PasswordAccount`・`SignInThrottle` はある。Web は段階 0 から `DATABASE_URL` で DB を読み、管理者を `AUTH_ALLOWED_GITHUB_IDS`、デモを `DEMO_LOGIN_ID` で決めている）。
      - マージのあと：1. Web の Production のデプロイが Ready。2. `vercel promote`。3. main から Go を再デプロイ（実行の前に、使う人に確かめる）。4. 本番で、管理者が試しの会員を 1 人作り、その会員でログインできること（Go のログインが Web のハッシュを受け付ける）、パスワードを再設定すると前のログインが切れることを確かめ、試しの会員は DB から消す（Web に削除の画面は無い）。
      - 切り替えのあいだ：古い Go と新しい Web は同じ形のハッシュを書き、同じ `sessionVersion` と同じ試行回数の鍵を使うので、どちらで変えても、もう一方のログインとセッションの確かめに効く。
      - 戻すとき：Go だけを戻しても害はない。Go を再デプロイしたあとで Web だけを戻すと、古い Web が消えたルートを呼んで `404` になる。管理画面の一覧はエラーの画面に、パスワードの変更は「処理できませんでした。時間をおいてもう一度お試しください。」になる。Web を戻すなら Go も戻す。Web が書いたハッシュは古い Go でも確かめられる。
  - 秘密の値は書かない。
- [ ] **Step 2: 古い記述を探す。**
  - `grep -rn "/v1/admin/accounts\|/v1/account/password\|login_id_taken\|password_mismatch\|invalid_current_password\|管理者だけが利用できます" README.md docs docs-site --include='*.md' --include='*.ts' | grep -v "docs/superpowers\|docs/releases\|\.vuepress/dist"` → 何も出ない。
  - `grep -rn "会員の管理\|アカウントの書き込み\|パスワード変更\|scrypt" README.md docs/architecture.md docs/features.md docs/roadmap.md docs/api-deployment.md docs/api-local.md docs-site --include='*.md' | grep -v "\.vuepress/dist"` の結果を 1 行ずつ読み、Go が会員の管理やパスワード変更を行うと書いた所が残っていないことを確かめる。
  - 変えたファイルで `node_modules/.bin/prettier --check` が通る。
- [ ] **Step 3: コミット。** `docs: 会員の管理とパスワード変更を Web に移したことを書く`
