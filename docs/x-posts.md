# X（旧Twitter）投稿の草案と、OGP・サイトマップ

学习録を X で紹介するときの投稿文の草案と、リンクを貼ったときに出るカード（OGP）、検索エンジン向けのサイトマップの説明です。投稿文はそのまま使っても、言い回しを変えても構いません。

## 前提

- 本番: <https://ffpf-zhuelog.sparklingstadt.com/>（`AUTH_URL` の origin。`https://ffpf-zhuelog.vercel.app/` も同じデプロイに付いていますが、canonical とサイトマップは `AUTH_URL` の方を指すので、投稿にもこちらを貼ります）
- ログインが要るアプリです。使えるのは、管理者が発行した ID・パスワードのアカウントか、FFPF ID の人です。ゲストは案内だけが見られます。投稿では「誰でも登録できる」とは書かないでください。
- X の文字数は、日本語（全角）1 文字が 2、半角が 1 で、合計 280 までです（日本語だけなら 140 文字）。URL は長さに関わらず 23 と数えます。下の草案は、すべてこの範囲に収めてあります。
- リンクは `https://ffpf-zhuelog.sparklingstadt.com/` を貼ります。ログイン前は `/signin` に飛びますが、カードはどちらの URL でも同じものが出ます。

## 草案 1: 公開のお知らせ（1 投稿）

```text
中国語の作文を添削してもらったあと、その学びを置きっぱなしにしないためのノート「学习録」を作りました。

原文と添削後の文、ピンイン、覚えるべきヒントを CSV で取り込み、復習・単語帳・練習問題までつなげます。

https://ffpf-zhuelog.sparklingstadt.com/
#中国語学習 #個人開発
```

## 草案 2: 機能紹介のスレッド（5 投稿）

1 つ目を投稿し、残りを返信でつなげます。

```text
1/5
「学习録」は、添削された中国語の文を蓄積するための学習ノートです。何ができるかを、順に紹介します。
https://ffpf-zhuelog.sparklingstadt.com/
#中国語学習
```

```text
2/5 CSV で取り込む
原文・添削後の文・ピンイン・ヒント（いくつでも）を 1 行にした CSV を取り込むと、学習ノートになります。添削前後の違いは色で見られます。
```

```text
3/5 復習と連続日数
取り込んだ文から復習の問題が出ます。間違えた問題は早めにもう一度出て、復習を続けた日数も見られます。学習ログはカレンダーで振り返れます。
```

```text
4/5 介詞・補語の練習と単語帳
介詞と補語の 4 択問題（25 問ずつ）で、よく迷うところを集中的に練習できます。単語帳はめくるカードで、ピンインと意味の下書きは AI が作ります。
```

```text
5/5 仲間と共有
メンバーをフォローすると、共有された学習ノートがタイムラインに流れます。LINE と連携すれば、LINE に文を送るだけで添削されてノートに溜まります。
FFPF ID があれば、そのままログインできます。
```

## 草案 3: 開発ログ風（短め）

```text
中国語の添削ノート「学习録」、復習の連続日数と学習ログのカレンダーを足しました。続けているのが見えると、少しだけ続けやすいです。
https://ffpf-zhuelog.sparklingstadt.com/
#中国語学習 #Nextjs
```

## 草案 4: 更新のお知らせの型

`docs/releases/vX.Y.Z.md` を書いたときに使う型です。1 つ目の行は見出しから、本文は箇条書きの 1〜2 個から取ります。

```text
学习録 vX.Y.Z

・（変わったことを 1 行で）
・（変わったことを 1 行で）

https://ffpf-zhuelog.sparklingstadt.com/
#中国語学習
```

例（v0.21.0）:

```text
学习録 v0.21.0

・FFPF ID でログインできるようになりました
・FFPF ID の人も、ノートの共有・フォロー・LINE 連携まで同じように使えます

https://ffpf-zhuelog.sparklingstadt.com/
#中国語学習
```

## OGP（リンクのカード）

リンクを X・LINE・Slack などに貼ったときに出るタイトル・説明・画像です。`src/app/layout.tsx` の `metadata` で全ページに付けています。

| 項目         | 値                                                                      |
| ------------ | ----------------------------------------------------------------------- |
| タイトル     | 学习録 \| 中国語学習ノート（ログイン画面は「ログイン \| 学习録」）      |
| 説明         | 添削文・ピンイン・学習ヒントをCSVから蓄積する中国語学習アプリ           |
| 画像         | `src/app/opengraph-image.png`（1200×630。X では `summary_large_image`） |
| 画像の代替文 | `src/app/opengraph-image.alt.txt`                                       |
| URL の元     | `AUTH_URL`（無ければ Vercel の本番ドメイン。`siteUrl()`）               |

画像は `scripts/og-image/opengraph-image.html` を Chromium で撮ったものです。文言や色を変えたら、`pnpm run og:render` で作り直してコミットします（手元の日本語フォントで描くので、機種で少し見た目が変わります。Chromium の場所を指定するときは `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`）。

確認のしかた:

- X の投稿画面に URL を貼ると、投稿する前にカードのプレビューが出ます。
- `curl -A Twitterbot https://ffpf-zhuelog.sparklingstadt.com/signin | grep -E 'og:|twitter:'` で、タグが出ているかを見られます。
- X は一度取ったカードをしばらく覚えています。画像を替えたのに古いままのときは、URL の末尾に `?v=2` のような印を付けて貼ると取り直します（画像の URL には Next.js がハッシュを付けるので、画像そのものは差し替わります）。

## サイトマップと robots.txt

- `https://ffpf-zhuelog.sparklingstadt.com/sitemap.xml`（`src/app/sitemap.ts`）: 載せているのは `/signin` だけです。ほかのページはログインが要り、クローラーには `/signin` へのリダイレクトしか見えないので、載せると「リダイレクトする URL」として報告されます。公開ページを足したら、ここにも足します。
- `https://ffpf-zhuelog.sparklingstadt.com/robots.txt`（`src/app/robots.ts`）: `/api/` だけを拒否し、サイトマップの場所を書いています。ログインが要るページは `robots.txt` では隠しません（隠すのはプロキシの役目で、クローラーは `/signin` に送られるだけです）。`/` を許したままにしているのは、X などのカード取得が `robots.txt` に従うためです。
- ログイン画面には `canonical` として `/signin` を付けています。`/signin?callbackUrl=...` の形が検索結果でばらけないようにするためです。
- これらのファイルと OGP 画像は、`src/infrastructure/go-api/go-proxy.ts` の `isMetadataFile` で、ログインなしで読める公開ルートにしています。
- Google Search Console に登録するなら、「サイトマップ」に `https://ffpf-zhuelog.sparklingstadt.com/sitemap.xml` を送ります。
