const csvExample = `最初の文,添削後の文,ピン音,ヒント1,ヒント2
"这个菜很好吃，我很喜欢。","这道菜很好吃，我很喜欢。","Zhè dào cài hěn hǎochī, wǒ hěn xǐhuan.","料理の量詞は「道」","很喜欢＝とても好き"`;

export function CsvFormatGuide() {
  return (
    <section
      aria-labelledby="csv-format-title"
      className="space-y-4 border-t pt-5"
    >
      <div className="space-y-1">
        <h3 id="csv-format-title" className="text-sm font-medium">
          対応するCSV形式
        </h3>
        <p className="text-xs leading-5 text-muted-foreground">
          1行につき1件の学習ノートを、次の列順で記入してください。
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs leading-5">
        <dt className="text-muted-foreground">1列目</dt>
        <dd>最初の文（必須）</dd>
        <dt className="text-muted-foreground">2列目</dt>
        <dd>添削後の文（必須）</dd>
        <dt className="text-muted-foreground">3列目</dt>
        <dd>ピン音（必須）</dd>
        <dt className="text-muted-foreground">4列目以降</dt>
        <dd>覚えるべきヒント（任意・100個まで）</dd>
      </dl>

      <figure className="min-w-0 space-y-2">
        <figcaption className="text-xs font-medium">
          記入例（ヒント2個）
        </figcaption>
        <pre className="whitespace-pre-wrap break-all rounded-lg border bg-muted/50 p-3 text-xs leading-6">
          <code>{csvExample}</code>
        </pre>
      </figure>

      <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
        <li>UTF-8の.csvファイルに対応しています（5MB・1,000行まで）。</li>
        <li>ヘッダー行は省略できます。</li>
        <li>各項目は1万文字、1行は10万文字までです。</li>
        <li>
          ヒントは1列に1個ずつ追加できます。行ごとに個数が違ってもよく、空欄は無視されます。
        </li>
        <li>
          半角カンマや改行を含む値は半角の二重引用符（&quot;）で囲みます。値の中の
          &quot; は &quot;&quot; と記入してください。
        </li>
      </ul>
    </section>
  );
}
