// The expected values in testdata/expected.json are what the web's
// CsvParseLearningParser returns for each fixture, with the bytes decoded the
// way the web controller does (File.text()). To regenerate them, save this as
// expected.ts outside the repository:
//
//	import { readdirSync, readFileSync } from "node:fs";
//	import { join } from "node:path";
//	import { CsvParseLearningParser } from "@/infrastructure/csv/csv-parse-learning-parser";
//	import { CsvValidationError } from "@/domain/learning/csv-validation-error";
//	const dir = process.argv[2];
//	const parser = new CsvParseLearningParser();
//	async function main() {
//	  const out: Record<string, unknown> = {};
//	  for (const name of readdirSync(dir).filter((n) => n.endsWith(".csv")).sort()) {
//	    const text = await new Blob([readFileSync(join(dir, name))]).text();
//	    try { out[name] = { entries: parser.parse(text) }; }
//	    catch (e) { if (!(e instanceof CsvValidationError)) throw e; out[name] = { error: e.message }; }
//	  }
//	  process.stdout.write(JSON.stringify(out, null, 1) + "\n");
//	}
//	void main();
//
// and run, from the repository root:
//
//	pnpm exec tsx /path/to/expected.ts services/api/csvimport/testdata > services/api/csvimport/testdata/expected.json
//	pnpm exec prettier --write services/api/csvimport/testdata/expected.json
package csvimport

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

type webEntry struct {
	OriginalText  string   `json:"originalText"`
	CorrectedText string   `json:"correctedText"`
	Pinyin        string   `json:"pinyin"`
	Hints         []string `json:"hints"`
}

type webResult struct {
	Entries []webEntry `json:"entries"`
	Error   *string    `json:"error"`
}

func TestParseMatchesWebFixtures(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "expected.json"))
	if err != nil {
		t.Fatal(err)
	}
	var expected map[string]webResult
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob(filepath.Join("testdata", "*.csv"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != len(expected) {
		t.Fatalf("%d fixtures but %d expected results; regenerate expected.json", len(files), len(expected))
	}
	for _, path := range files {
		name := filepath.Base(path)
		t.Run(name, func(t *testing.T) {
			want, ok := expected[name]
			if !ok {
				t.Fatalf("no expected result for %s", name)
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			got, err := Parse(bytes.NewReader(data))
			if want.Error != nil {
				var ve *ValidationError
				if !errors.As(err, &ve) {
					t.Fatalf("err = %v, want ValidationError %q", err, *want.Error)
				}
				if ve.Message != *want.Error {
					t.Fatalf("message = %q, want %q", ve.Message, *want.Error)
				}
				return
			}
			if err != nil {
				t.Fatalf("Parse: %v", err)
			}
			wantDrafts := make([]store.EntryDraft, len(want.Entries))
			for i, e := range want.Entries {
				wantDrafts[i] = store.EntryDraft{Kind: "correction", OriginalText: e.OriginalText, CorrectedText: e.CorrectedText, Pinyin: e.Pinyin, Hints: e.Hints}
			}
			if !reflect.DeepEqual(got, wantDrafts) {
				t.Fatalf("drafts differ from the web:\n got %.500q\nwant %.500q", got, wantDrafts)
			}
		})
	}
}

func TestParseLimits(t *testing.T) {
	rows := func(n int) string {
		var b strings.Builder
		for i := 1; i <= n; i++ {
			b.WriteString("o" + strconv.Itoa(i) + ",c,p\n")
		}
		return b.String()
	}
	hints := func(n int) string {
		h := make([]string, n)
		for i := range h {
			h[i] = "h"
		}
		return strings.Join(h, ",")
	}
	const (
		msgLimit    = "上限（各項目1万文字・ヒント100列）を超えています。"
		msgRequired = "の「最初の文」「添削後の文」「ピン音」は必須です。"
	)
	bad := []struct {
		name, in, want string
	}{
		{"1001 rows", rows(1001), "一度にインポートできるのは1000件までです。"},
		{"1001 rows after a header", "original,corrected,pinyin\n" + rows(1001), "一度にインポートできるのは1000件までです。"},
		{"10001-character cell", "a,b,c\nx," + strings.Repeat("字", 10_001) + ",z\n", "2行目は" + msgLimit},
		{"104 columns", "a,b,c," + hints(101) + "\n", "1行目は" + msgLimit},
		{"no data rows", "", "CSVにデータ行がありません。"},
		{"header only", "最初の文,添削後の文,ピン音\n", "CSVにデータ行がありません。"},
		{"fewer than 3 columns", "a,b,c\nx,y\n", "2行目は3列未満です。"},
		{"empty required cell", "原文,添削文,拼音\na,b,c\na,b,\u3000\n", "3行目" + msgRequired},
		{"record over 100000 bytes", strings.Repeat(strings.Repeat("a", 9_999)+",", 11) + "\n", msgFormat},
		{"unclosed quote", "a,b,\"c\n", msgFormat},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse(strings.NewReader(tc.in))
			var ve *ValidationError
			if !errors.As(err, &ve) || ve.Message != tc.want {
				t.Fatalf("err = %v, want ValidationError %q", err, tc.want)
			}
		})
	}

	ok := []struct {
		name string
		in   string
		n    int
	}{
		{"1000 rows", rows(1000), 1000},
		{"10000-character cell", "x," + strings.Repeat("字", 10_000) + ",z\n", 1},
		{"100 hints", "a,b,c," + hints(100) + "\n", 1},
	}
	for _, tc := range ok {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Parse(strings.NewReader(tc.in))
			if err != nil || len(got) != tc.n {
				t.Fatalf("got %d drafts, err %v; want %d", len(got), err, tc.n)
			}
		})
	}
}

func TestParseReturnsReadErrors(t *testing.T) {
	boom := errors.New("boom")
	_, err := Parse(errReader{boom})
	var ve *ValidationError
	if !errors.Is(err, boom) || errors.As(err, &ve) {
		t.Fatalf("err = %v, want the read error", err)
	}
}

type errReader struct{ err error }

func (r errReader) Read([]byte) (int, error) { return 0, r.err }

func TestTruncateUTF16(t *testing.T) {
	cases := []struct {
		in   string
		n    int
		want string
	}{
		{"abc", 5, "abc"},
		{"abcdef", 3, "abc"},
		{"字字字", 2, "字字"},
		{"a😀b", 2, "a\uFFFD"}, // JS slice keeps a lone high surrogate, stored as U+FFFD
		{"a😀b", 3, "a😀"},
	}
	for _, c := range cases {
		if got := TruncateUTF16(c.in, c.n); got != c.want {
			t.Errorf("TruncateUTF16(%q, %d) = %q, want %q", c.in, c.n, got, c.want)
		}
	}
}

func TestParseRejectsNUL(t *testing.T) {
	// Postgres cannot store NUL, so it is reported as a format problem before
	// anything is saved. Other problems the web reports first still win.
	cases := []struct{ name, in, want string }{
		{"in a required cell", "a\x00b,c,d\n", msgFormat},
		{"in a hint", "a,b,c,h\x00\n", msgFormat},
		{"in a later row", "a,b,c\nd,e,\x00f\n", msgFormat},
		{"row errors first", "a\x00,b,c\nd,e\n", "2行目は3列未満です。"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse(strings.NewReader(tc.in))
			var ve *ValidationError
			if !errors.As(err, &ve) || ve.Message != tc.want {
				t.Fatalf("err = %v, want ValidationError %q", err, tc.want)
			}
		})
	}
}

func TestFileName(t *testing.T) {
	if got, err := FileName(strings.Repeat("字", 300)); err != nil || got != strings.Repeat("字", 255) {
		t.Fatalf("FileName = %q, %v", got, err)
	}
	_, err := FileName("a\x00.csv")
	var ve *ValidationError
	if !errors.As(err, &ve) || ve.Message != msgFormat {
		t.Fatalf("NUL in name: err = %v", err)
	}
}
