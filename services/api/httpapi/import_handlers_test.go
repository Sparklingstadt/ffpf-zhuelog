package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

type importCall struct {
	owner, fileName string
	drafts          []store.EntryDraft
	now             time.Time
}

// importRouter serves the full router to a caller with the given role and
// records CreateImportBatch calls.
func importRouter(t *testing.T, role string, fail error) (http.Handler, *[]importCall, *bytes.Buffer) {
	t.Helper()
	calls := &[]importCall{}
	e := &fakeEntries{createImport: func(_ context.Context, owner, fileName string, drafts []store.EntryDraft, now time.Time) (store.Batch, []store.Entry, error) {
		*calls = append(*calls, importCall{owner, fileName, drafts, now})
		if fail != nil {
			return store.Batch{}, nil, fail
		}
		return store.Batch{ID: "batch1", ImportedAt: now}, make([]store.Entry, len(drafts)), nil
	}}
	a := &fakeAuth{authenticate: func(_ context.Context, tok string) (auth.Principal, error) {
		if tok != "tok" {
			return auth.Principal{}, auth.ErrUnauthorized
		}
		return auth.Principal{OwnerID: testOwner, Role: role}, nil
	}}
	logs := &bytes.Buffer{}
	c := newClock()
	h := NewRouter(Deps{Auth: a, Entries: e, Logger: slog.New(slog.NewJSONHandler(logs, nil)), Now: c.Now})
	return h, calls, logs
}

type formPart struct {
	name, fileName string // fileName "" makes a plain text field
	content        []byte
}

func multipartBody(t *testing.T, parts ...formPart) (string, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for _, p := range parts {
		var w interface{ Write([]byte) (int, error) }
		var err error
		if p.fileName == "" {
			w, err = mw.CreateFormField(p.name)
		} else {
			w, err = mw.CreateFormFile(p.name, p.fileName)
		}
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(p.content); err != nil {
			t.Fatal(err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.String(), mw.FormDataContentType()
}

func postImport(t *testing.T, h http.Handler, target string, parts ...formPart) *httptest.ResponseRecorder {
	t.Helper()
	body, ct := multipartBody(t, parts...)
	return do(h, http.MethodPost, target, body, map[string]string{"Authorization": "Bearer tok", "Content-Type": ct})
}

func wantErrorMessage(t *testing.T, w *httptest.ResponseRecorder, status int, code, message string) {
	t.Helper()
	wantError(t, w, status, code)
	var resp errorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Error.Message != message {
		t.Fatalf("message = %q, want %q", resp.Error.Message, message)
	}
}

func TestImportCSVHandlerSuccess(t *testing.T) {
	for _, role := range []string{auth.RoleAdmin, auth.RoleMember} {
		t.Run(role, func(t *testing.T) {
			h, calls, _ := importRouter(t, role, nil)
			csv := "\ufeff原文,添削文,拼音\r\n a ,b,c,h1,,h2\r\n\"x\ny\",z,p\r\n"
			w := postImport(t, h, "/v1/imports/csv",
				formPart{name: "other", content: []byte("ignored")},
				formPart{name: "csvFile", fileName: "Notes.CSV", content: []byte(csv)})
			if w.Code != http.StatusCreated {
				t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
			}
			if got, want := w.Body.String(), `{"batch":{"id":"batch1","importedAt":"2026-10-20T12:00:00.000Z"},"count":2}`; got != want {
				t.Fatalf("body = %s, want %s", got, want)
			}
			want := []importCall{{
				owner:    testOwner,
				fileName: "Notes.CSV",
				drafts: []store.EntryDraft{
					{Kind: "correction", OriginalText: "a", CorrectedText: "b", Pinyin: "c", Hints: []string{"h1", "h2"}},
					{Kind: "correction", OriginalText: "x\ny", CorrectedText: "z", Pinyin: "p", Hints: []string{}},
				},
				now: newClock().Now(),
			}}
			if !reflect.DeepEqual(*calls, want) {
				t.Fatalf("calls = %+v, want %+v", *calls, want)
			}
		})
	}
}

func TestImportCSVHandlerTruncatesFileName(t *testing.T) {
	h, calls, _ := importRouter(t, auth.RoleMember, nil)
	name := strings.Repeat("あ", 296) + ".csv"
	w := postImport(t, h, "/v1/imports/csv", formPart{name: "csvFile", fileName: name, content: []byte("a,b,c\n")})
	if w.Code != http.StatusCreated || len(*calls) != 1 {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	if got := (*calls)[0].fileName; got != strings.Repeat("あ", 255) {
		t.Fatalf("fileName = %q (%d runes)", got, len([]rune(got)))
	}
}

func TestImportCSVHandlerRejectsFiles(t *testing.T) {
	const (
		msgSelect = "CSVファイルを選択してください。"
		msgExt    = "拡張子が.csvのファイルを選択してください。"
	)
	fivePlus := bytes.Repeat([]byte("a"), 5<<20+1)
	cases := []struct {
		name   string
		parts  []formPart
		status int
		code   string
		msg    string
	}{
		{"no csvFile part", []formPart{{name: "other", fileName: "a.csv", content: []byte("a,b,c\n")}}, 400, "invalid_request", msgSelect},
		{"no parts", nil, 400, "invalid_request", msgSelect},
		{"empty file", []formPart{{name: "csvFile", fileName: "a.csv"}}, 400, "invalid_request", msgSelect},
		{"text field, not a file", []formPart{{name: "csvFile", content: []byte("a,b,c\n")}}, 400, "invalid_request", msgSelect},
		{"txt extension", []formPart{{name: "csvFile", fileName: "a.txt", content: []byte("a,b,c\n")}}, 400, "invalid_request", msgExt},
		{"no dot", []formPart{{name: "csvFile", fileName: "acsv", content: []byte("a,b,c\n")}}, 400, "invalid_request", msgExt},
		{"csv not last", []formPart{{name: "csvFile", fileName: "a.csv.txt", content: []byte("a,b,c\n")}}, 400, "invalid_request", msgExt},
		{"over 5 MiB", []formPart{{name: "csvFile", fileName: "a.csv", content: fivePlus}}, 413, "too_large", "ファイルは5MB以下にしてください。"},
		{"over 5 MiB and not csv: size first", []formPart{{name: "csvFile", fileName: "a.txt", content: fivePlus}}, 413, "too_large", "ファイルは5MB以下にしてください。"},
		{"unclosed quote", []formPart{{name: "csvFile", fileName: "a.csv", content: []byte("a,b,\"c\n")}}, 400, "invalid_csv",
			"CSVの形式を確認してください。引用符が閉じていないか、1行が長すぎる可能性があります。"},
		{"missing pinyin", []formPart{{name: "csvFile", fileName: "a.csv", content: []byte("a,b,c\nd,e,\n")}}, 400, "invalid_csv",
			"2行目の「最初の文」「添削後の文」「ピン音」は必須です。"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h, calls, _ := importRouter(t, auth.RoleMember, nil)
			wantErrorMessage(t, postImport(t, h, "/v1/imports/csv", tc.parts...), tc.status, tc.code, tc.msg)
			if len(*calls) != 0 {
				t.Fatalf("store called %d times", len(*calls))
			}
		})
	}
}

func TestImportCSVHandlerRejectsNUL(t *testing.T) {
	const msgFormat = "CSVの形式を確認してください。引用符が閉じていないか、1行が長すぎる可能性があります。"
	// A raw NUL in a part header is malformed MIME, but RFC 5987 filename*
	// can carry one.
	cases := map[string]struct{ disposition, content string }{
		"NUL in a cell":        {`form-data; name="csvFile"; filename="a.csv"`, "a,b\x00,c\n"},
		"NUL in the file name": {`form-data; name="csvFile"; filename*=UTF-8''a%00b.csv`, "a,b,c\n"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			h, calls, logs := importRouter(t, auth.RoleMember, nil)
			body := "--X\r\nContent-Disposition: " + tc.disposition + "\r\n\r\n" + tc.content + "\r\n--X--\r\n"
			w := do(h, http.MethodPost, "/v1/imports/csv", body, map[string]string{"Authorization": "Bearer tok", "Content-Type": "multipart/form-data; boundary=X"})
			wantErrorMessage(t, w, http.StatusBadRequest, "invalid_csv", msgFormat)
			if len(*calls) != 0 {
				t.Fatal("store called")
			}
			if strings.Contains(logs.String(), `"level":"ERROR"`) {
				t.Fatalf("error logged: %s", logs.String())
			}
		})
	}
}

func TestImportCSVHandlerAllowsExactly5MiB(t *testing.T) {
	// 5 MiB passes the size check (and the 6 MiB body limit of this route,
	// above the 1 MiB used elsewhere); it then fails on the row limit.
	h, _, _ := importRouter(t, auth.RoleMember, nil)
	content := bytes.Repeat([]byte("a,b,c\n"), 5<<20/6)
	content = append(content, bytes.Repeat([]byte("\n"), 5<<20-len(content))...)
	wantErrorMessage(t, postImport(t, h, "/v1/imports/csv", formPart{name: "csvFile", fileName: "a.csv", content: content}),
		http.StatusBadRequest, "invalid_csv", "一度にインポートできるのは1000件までです。")
}

func TestImportCSVHandlerBodyLimit(t *testing.T) {
	h, calls, _ := importRouter(t, auth.RoleMember, nil)
	big := bytes.Repeat([]byte("x"), 6<<20)
	w := postImport(t, h, "/v1/imports/csv",
		formPart{name: "padding", content: big},
		formPart{name: "csvFile", fileName: "a.csv", content: []byte("a,b,c\n")})
	wantError(t, w, http.StatusRequestEntityTooLarge, "too_large")
	if len(*calls) != 0 {
		t.Fatalf("store called %d times", len(*calls))
	}
}

func TestImportCSVHandlerRequests(t *testing.T) {
	t.Run("not multipart", func(t *testing.T) {
		h, _, _ := importRouter(t, auth.RoleMember, nil)
		w := do(h, http.MethodPost, "/v1/imports/csv", `{"csv":"a,b,c"}`, map[string]string{"Authorization": "Bearer tok", "Content-Type": "application/json"})
		wantError(t, w, http.StatusBadRequest, "invalid_request")
	})
	t.Run("unauthenticated", func(t *testing.T) {
		h, _, _ := importRouter(t, auth.RoleMember, nil)
		body, ct := multipartBody(t, formPart{name: "csvFile", fileName: "a.csv", content: []byte("a,b,c\n")})
		wantError(t, do(h, http.MethodPost, "/v1/imports/csv", body, map[string]string{"Content-Type": ct}), http.StatusUnauthorized, "unauthorized")
	})
	for _, role := range []string{"guest", ""} {
		t.Run("role "+role+" is forbidden", func(t *testing.T) {
			h, calls, _ := importRouter(t, role, nil)
			wantError(t, postImport(t, h, "/v1/imports/csv", formPart{name: "csvFile", fileName: "a.csv", content: []byte("a,b,c\n")}),
				http.StatusForbidden, "forbidden")
			if len(*calls) != 0 {
				t.Fatal("store called")
			}
		})
	}
	t.Run("?user= is rejected", func(t *testing.T) {
		h, _, _ := importRouter(t, auth.RoleAdmin, nil)
		wantError(t, postImport(t, h, "/v1/imports/csv?user=123", formPart{name: "csvFile", fileName: "a.csv", content: []byte("a,b,c\n")}),
			http.StatusBadRequest, "invalid_request")
	})
}

func TestImportCSVHandlerNeverLogsContents(t *testing.T) {
	const secret = "秘密の文章zz9"
	for _, tc := range []struct {
		name string
		csv  string
		fail error
	}{
		{"store error", secret + ",b,c\n", errors.New("store: create batch: boom")},
		{"invalid csv", secret + ",b\n", nil},
		{"success", secret + ",b,c\n", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, _, logs := importRouter(t, auth.RoleMember, tc.fail)
			w := postImport(t, h, "/v1/imports/csv", formPart{name: "csvFile", fileName: "a.csv", content: []byte(tc.csv)})
			if tc.fail != nil {
				wantError(t, w, http.StatusInternalServerError, "internal")
			}
			if strings.Contains(logs.String(), secret) || strings.Contains(w.Body.String(), secret) {
				t.Fatalf("CSV contents leaked: logs %s body %s", logs.String(), w.Body.String())
			}
		})
	}
}
