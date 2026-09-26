import { defineIntegration } from "@ffpf-zhuelog/core/integration";

import { createTypleExport, extractTypleWords } from "./typle-word-list";

// Named exports keep the legacy /typle routes working until the shared
// integration screen replaces them.
export {
  createTypleExport,
  extractTypleWords,
  type TypleExport,
  type TypleWord,
  type TypleWordList,
} from "./typle-word-list";

export default defineIntegration({
  id: "typle",
  text: {
    navLabel: "Typle用リスト",
    title: "Typle用の復習リスト",
    description:
      "添削で増えた中国語と、ヒント内で引用された語を集めて、Typleの保存形式へ整えます。",
    listTitle: "自動生成された単語リスト",
    listDescription:
      "表示文字と入力文字には中国語を、補足には元のヒント・例文・拼音を入れます。同じ語は1件にまとめます。",
    sources: ["ヒントの「引用語」", "添削で追加された語"],
    emptyMessage:
      "抽出できる語がまだありません。ヒントに中国語を「」で記録するか、添削を追加してください。",
    downloadLabel: "Typle互換JSONをダウンロード",
  },
  preview(entries) {
    const words = extractTypleWords(entries);
    return {
      stats: [
        { label: "抽出した復習語", value: `${words.length}語` },
        { label: "Typleでの入力", value: "中国語IME" },
      ],
      items: words.map((word) => ({
        title: word.display,
        description: word.annotation,
        lang: "zh-Hans",
      })),
    };
  },
  export(entries) {
    const payload = createTypleExport(entries);
    if (payload.lists[0].words.length === 0) return null;
    return {
      fileName: "ffpf-zhuelog-typle-words.json",
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(payload, null, 2),
    };
  },
});
