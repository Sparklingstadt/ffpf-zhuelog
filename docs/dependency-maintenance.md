# 依存関係PRの運用

## 2026-09-24 の整理

| PR      | 判断                                       | 理由                                                                                                                                      |
| ------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| #1 / #2 | checkout / setup-node を v7 にまとめて更新 | GitHub-hosted runnerで検証する。checkout の既存失敗は古いベースのlockfile不整合であり、Action自体の失敗ではなかった。                     |
| #3 / #7 | React / React DOM を同時に 19.3.0 に更新   | React DOM 19.3.0 は React ^19.3.0 を要求するため、個別更新では npm ci が失敗する。                                                        |
| #4      | TypeScript 7 を保留                        | typescript-eslint 8.70.x の対応範囲は >=4.8.4 <6.1.0。既存CIで「typescript-eslint does not support TS 7.0」となった。                     |
| #5      | Node 26用の型ではなく Node 22用へ更新      | package.json の最低実行環境とCIは Node 22。型だけを26にすると、実行環境にないAPIを型チェックが許容してしまう。                            |
| #6      | ESLint 10 を保留                           | eslint-config-next 経由の eslint-plugin-react 7.37.5 は ESLint 9まで対応。既存CIで react/display-name の getFilename 呼び出しが失敗した。 |

アプリの機能、DB、認証、課金先、Next.js/Turbopackのバージョンは変更しない。

## 再発防止

- ReactとReact DOM、およびそれぞれの型定義は同じPRで更新する。
- Next.jsとeslint-config-nextも同じPRで更新する。
- その他のminor/patch更新とGitHub Actions更新はそれぞれグループ化する。major更新は互換性を個別に確認する。
- CIで型チェック・Lint・ユニットテスト・ビルド・PC/モバイルE2E・npm auditを実行する。警告の無効化や `--force` / `--legacy-peer-deps` による回避は行わない。
- 実行環境の最低バージョンを変更する際は、Nodeの型・CI・README・本番設定を一緒に見直す。

## 保留を解除する条件

TypeScript 7 / ESLint 10 は、Next.js側の対応と、その設定が実際に読み込むプラグインのpeerDependencies・移行手順を再確認してから `.github/dependabot.yml` の該当ignoreを削除する。単体パッケージのリリースだけでは解除しない。

この保留は互換性判断であり、安全性を保証するものではない。Dependabotの脆弱性アラートと `npm audit` は継続して確認する。保留範囲の更新がセキュリティ修正に必要になった場合は、互換性修正も含めて優先対応する。

## 参考

- [Dependabotのgroups / ignore設定](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
- [actions/checkout](https://github.com/actions/checkout)
- [actions/setup-node](https://github.com/actions/setup-node)
- [typescript-eslintの対応バージョン](https://typescript-eslint.io/users/dependency-versions/)
- [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react)
