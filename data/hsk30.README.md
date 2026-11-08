# hsk30.csv

HSK 3.0（中国教育部の「国际中文教育中文水平等级标准」GF0025-2021）の語彙表 11,092 語を、1 行 1 語にまとめた CSV です。`scripts/generate-hsk-words.ts` がここから `src/domain/practice/hsk-words-official.ts` を作ります。

- 出典: <https://github.com/ivankra/hsk30>（`hsk30.csv`）
- コミット: [`4ff9e39`](https://github.com/ivankra/hsk30/commit/4ff9e3915ce87baaecd7ebe263085573a4ea3192)（2023-11-08）。2026-11-09 にダウンロードし、手を加えずに置いています。
- SHA-256: `8c2b73f74776240bcf154624730fc6fb2c42c254d5c5d0f88943878b8e575b9b`
- ライセンス: MIT（下に全文）

使う列は `ID`・`Simplified`・`Pinyin`・`Level`・`Variants` です。`Level` は 1〜6 と `7-9`（7〜9 級はまとめて 1 つ）です。`Simplified` には「爸爸|爸」「有（一）些」「第（第二）」「称1」のような書き方の行があり、その語形は `Variants` 列（JSON）に 1 つずつ書かれています。

更新するときは、新しい `hsk30.csv` を置き換えてこのファイルのコミット・日付・SHA-256 を直し、`node --import tsx scripts/generate-hsk-words.ts` を流し直します。

## ライセンス

```text
MIT License

Copyright (c) 2023 Ivan Krasilnikov
Copyright (c) 2021 Shawky
Copyright (c) 2021 Pleco Inc.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
