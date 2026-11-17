package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakePinger struct{ err error }

func (p fakePinger) Ping(context.Context) error { return p.err }

// clock is a settable time source.
type clock struct{ t time.Time }

func newClock() *clock { return &clock{t: time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)} }

func (c *clock) Now() time.Time { return c.t }

// testRouter builds the full router with a JSON logger writing to the
// returned buffer.
func testRouter(t *testing.T, db Pinger, c *clock) (http.Handler, *bytes.Buffer) {
	t.Helper()
	buf := &bytes.Buffer{}
	if c == nil {
		c = newClock()
	}
	h := NewRouter(Deps{
		DB:     db,
		Logger: slog.New(slog.NewJSONHandler(buf, nil)),
		Now:    c.Now,
	})
	return h, buf
}

func do(h http.Handler, method, target, body string, headers map[string]string) *httptest.ResponseRecorder {
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, target, nil)
	} else {
		r = httptest.NewRequest(method, target, strings.NewReader(body))
	}
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

type errorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func decodeError(t *testing.T, w *httptest.ResponseRecorder) errorResponse {
	t.Helper()
	var e errorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil {
		t.Fatalf("response is not an error body: %q (%v)", w.Body.String(), err)
	}
	return e
}

func wantError(t *testing.T, w *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status = %d, want %d (body %q)", w.Code, status, w.Body.String())
	}
	e := decodeError(t, w)
	if e.Error.Code != code {
		t.Fatalf("code = %q, want %q", e.Error.Code, code)
	}
	if e.Error.Message == "" {
		t.Fatal("error message is empty")
	}
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
}
