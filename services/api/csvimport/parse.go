// Package csvimport parses learning-entry CSV files exactly like the web's
// CsvParseLearningParser (csv-parse/sync with bom, skip_empty_lines,
// relax_column_count, trim, max_record_size 100000 and to 1002).
//
// encoding/csv cannot reproduce csv-parse here (it rewrites \r\n inside quoted
// fields, accepts any mix of line endings, trims only ASCII spaces and has no
// byte-based record limit), so the record reader below is a port of the parts
// of csv-parse's state machine those options use. testdata/expected.json holds
// the web's results for every fixture and keeps the two in step.
package csvimport

import (
	"bytes"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/jsstr"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// ValidationError is a problem with the CSV whose Message (the web's wording)
// may be shown to the client.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

const (
	maxRows       = 1000
	maxCellUnits  = 10_000 // UTF-16 code units, like JS string length
	maxColumns    = 3 + 100
	maxRecordSize = 100_000
	maxFileName   = 255

	msgFormat      = "CSVの形式を確認してください。引用符が閉じていないか、1行が長すぎる可能性があります。"
	msgNoData      = "CSVにデータ行がありません。"
	msgTooManyRows = "一度にインポートできるのは1000件までです。"
)

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// Parse reads the whole CSV and returns one correction draft per data row, or
// a *ValidationError. Errors from r are returned as they are.
func Parse(r io.Reader) ([]store.EntryDraft, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	// File.text() drops one BOM and replaces invalid UTF-8; csv-parse's bom
	// option then drops one more.
	text := bytes.TrimPrefix(decodeUTF8(bytes.TrimPrefix(data, utf8BOM)), utf8BOM)
	records, ok := readRecords(text, maxRows+2)
	if !ok {
		return nil, &ValidationError{msgFormat}
	}
	if len(records) == 0 {
		return nil, &ValidationError{msgNoData}
	}
	offset := 0
	if isHeader(records[0]) {
		offset = 1
	}
	rows := records[offset:]
	if len(rows) == 0 {
		return nil, &ValidationError{msgNoData}
	}
	if len(rows) > maxRows {
		return nil, &ValidationError{msgTooManyRows}
	}

	drafts := make([]store.EntryDraft, len(rows))
	for i, row := range rows {
		line := strconv.Itoa(i + offset + 1)
		if len(row) < 3 {
			return nil, &ValidationError{line + "行目は3列未満です。"}
		}
		if len(row) > maxColumns || anyLongerThan(row, maxCellUnits) {
			return nil, &ValidationError{line + "行目は上限（各項目1万文字・ヒント100列）を超えています。"}
		}
		cells := make([]string, len(row))
		for j, c := range row {
			cells[j] = jsstr.Trim(c)
		}
		if cells[0] == "" || cells[1] == "" || cells[2] == "" {
			return nil, &ValidationError{line + "行目の「最初の文」「添削後の文」「ピン音」は必須です。"}
		}
		hints := []string{}
		for _, h := range cells[3:] {
			if h != "" {
				hints = append(hints, h)
			}
		}
		drafts[i] = store.EntryDraft{
			Kind:          "correction",
			OriginalText:  cells[0],
			CorrectedText: cells[1],
			Pinyin:        cells[2],
			Hints:         hints,
		}
	}
	// Postgres cannot store NUL. The web fails only when saving; here it is a
	// format error, raised after every check the web makes so those still win.
	for _, d := range drafts {
		if hasNUL(d.OriginalText, d.CorrectedText, d.Pinyin) || hasNUL(d.Hints...) {
			return nil, &ValidationError{msgFormat}
		}
	}
	return drafts, nil
}

func hasNUL(ss ...string) bool {
	for _, s := range ss {
		if strings.IndexByte(s, 0) >= 0 {
			return true
		}
	}
	return false
}

// FileName is what the web stores for an uploaded file name: decoded as UTF-8
// and cut to 255 UTF-16 code units. A name with NUL, which Postgres cannot
// store, is a *ValidationError with the format message.
func FileName(name string) (string, error) {
	if hasNUL(name) {
		return "", &ValidationError{msgFormat}
	}
	return jsstr.Truncate(string(decodeUTF8([]byte(name))), maxFileName), nil
}

var headerNames = [3][]string{
	{"最初の文", "原文", "original"},
	{"添削後の文", "添削文", "corrected"},
	{"ピン音", "拼音", "pinyin"},
}

func isHeader(row []string) bool {
	if len(row) < 3 {
		return false
	}
	for i, names := range headerNames {
		// ASCII lowercasing gives the same matches as JS toLowerCase: no other
		// character lowercases to the ASCII letters of these names
		// (strings.ToLower would turn U+0130 into "i", JS into "i\u0307").
		cell := asciiLower(strings.ReplaceAll(jsstr.Trim(row[i]), " ", ""))
		found := false
		for _, n := range names {
			if cell == n {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if 'A' <= c && c <= 'Z' {
			b[i] = c + 'a' - 'A'
		}
	}
	return string(b)
}

func anyLongerThan(row []string, max int) bool {
	for _, c := range row {
		if jsstr.Len(c) > max {
			return true
		}
	}
	return false
}

// trimLen returns the byte length of the trimmable character at buf[pos], or 0.
func trimLen(buf []byte, pos int) int {
	if pos >= len(buf) {
		return 0
	}
	r, size := utf8.DecodeRune(buf[pos:])
	if r == utf8.RuneError && size <= 1 {
		return 0
	}
	if jsstr.IsSpace(r) {
		return size
	}
	return 0
}

// decodeUTF8 converts b to valid UTF-8 the way the WHATWG decoder (used by
// File.text()) does: each maximal invalid subsequence becomes one U+FFFD.
func decodeUTF8(b []byte) []byte {
	if utf8.Valid(b) {
		return b
	}
	const replacement = "\uFFFD"
	out := make([]byte, 0, len(b)+8)
	for i := 0; i < len(b); {
		c := b[i]
		need := 0
		lower, upper := byte(0x80), byte(0xBF)
		switch {
		case c < 0x80:
			out = append(out, c)
			i++
			continue
		case c >= 0xC2 && c <= 0xDF:
			need = 1
		case c >= 0xE0 && c <= 0xEF:
			need = 2
			if c == 0xE0 {
				lower = 0xA0
			} else if c == 0xED {
				upper = 0x9F
			}
		case c >= 0xF0 && c <= 0xF4:
			need = 3
			if c == 0xF0 {
				lower = 0x90
			} else if c == 0xF4 {
				upper = 0x8F
			}
		default:
			out = append(out, replacement...)
			i++
			continue
		}
		j, seen := i+1, 0
		for seen < need && j < len(b) && b[j] >= lower && b[j] <= upper {
			lower, upper = 0x80, 0xBF
			j++
			seen++
		}
		if seen == need {
			out = append(out, b[i:j]...)
		} else {
			out = append(out, replacement...) // the byte at j, if any, is read again
		}
		i = j
	}
	return out
}

// csvReader is the state of csv-parse's parser for the options the web uses:
// delimiter ",", quote and escape `"`, ltrim and rtrim, skip_empty_lines,
// relax_column_count and max_record_size. Positions are bytes, as in
// csv-parse.
type csvReader struct {
	buf        []byte
	rd         []byte // record delimiter, discovered at the first line break
	quoting    bool
	wasQuoting bool
	escaping   bool
	field      []byte
	record     []string
	recordLen  int // UTF-16 length of the record's finished fields
	records    [][]string
}

// readRecords parses buf, stopping after limit records like csv-parse's to
// option. ok is false wherever csv-parse throws.
func readRecords(buf []byte, limit int) (records [][]string, ok bool) {
	p := &csvReader{buf: buf}
	n := len(buf)
	for pos := 0; pos < n; pos++ {
		if !p.quoting && p.rd == nil {
			p.discover(pos)
		}
		chr := buf[pos]
		if p.escaping {
			p.escaping = false
		} else {
			if p.quoting && chr == '"' && pos+1 < n && buf[pos+1] == '"' {
				p.escaping = true
				continue
			}
			if chr == '"' {
				if p.quoting {
					next := pos + 1
					var rdLen int
					if p.rd == nil {
						rdLen = p.discover(next)
					} else {
						rdLen = p.isRecordDelimiter(next)
					}
					if next >= n || buf[next] == 0 || buf[next] == ',' || rdLen > 0 || trimLen(buf, next) > 0 {
						p.quoting, p.wasQuoting = false, true
						continue
					}
					return nil, false // CSV_INVALID_CLOSING_QUOTE
				}
				if len(p.field) != 0 {
					return nil, false // INVALID_OPENING_QUOTE
				}
				p.quoting = true
				continue
			}
			if !p.quoting {
				if l := p.isRecordDelimiter(pos); l > 0 {
					if !p.wasQuoting && len(p.record) == 0 && len(p.field) == 0 {
						pos += l - 1 // skip_empty_lines
						continue
					}
					p.endField()
					p.endRecord()
					if len(p.records) >= limit {
						return p.records, true
					}
					pos += l - 1
					continue
				}
				if chr == ',' {
					p.endField()
					continue
				}
			}
		}
		if p.recordLen+len(p.field) > maxRecordSize {
			return nil, false // CSV_MAX_RECORD_SIZE
		}
		t := trimLen(buf, pos)
		lappend := p.quoting || len(p.field) != 0 || t == 0
		rappend := !p.wasQuoting
		switch {
		case lappend && rappend:
			p.field = append(p.field, chr)
		case t == 0:
			return nil, false // CSV_NON_TRIMABLE_CHAR_AFTER_CLOSING_QUOTE
		case !lappend:
			pos += t - 1
		}
	}
	if p.quoting {
		return nil, false // CSV_QUOTE_NOT_CLOSED
	}
	if p.wasQuoting || len(p.record) != 0 || len(p.field) != 0 {
		p.endField()
		p.endRecord()
	}
	return p.records, true
}

// discover fixes the record delimiter if one starts at pos, returning its
// length.
func (p *csvReader) discover(pos int) int {
	for _, rd := range []string{"\r\n", "\n", "\r"} {
		if bytes.HasPrefix(p.buf[pos:], []byte(rd)) {
			p.rd = []byte(rd)
			return len(rd)
		}
	}
	return 0
}

func (p *csvReader) isRecordDelimiter(pos int) int {
	if p.rd != nil && pos < len(p.buf) && bytes.HasPrefix(p.buf[pos:], p.rd) {
		return len(p.rd)
	}
	return 0
}

func (p *csvReader) endField() {
	f := string(p.field)
	if !p.wasQuoting {
		f = strings.TrimRightFunc(f, jsstr.IsSpace)
	}
	p.record = append(p.record, f)
	p.recordLen += jsstr.Len(f)
	p.field = p.field[:0]
	p.wasQuoting = false
}

func (p *csvReader) endRecord() {
	p.records = append(p.records, p.record)
	p.record = nil
	p.recordLen = 0
}
