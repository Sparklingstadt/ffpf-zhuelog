package httpapi

import (
	"encoding/base64"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

func TestCursorRoundTrip(t *testing.T) {
	c := store.Cursor{CreatedAt: time.Date(2026, 10, 20, 12, 34, 56, 789_000_000, time.UTC), ID: "cabc123"}
	s := encodeCursor(c)
	if strings.ContainsAny(s, "=+/") {
		t.Fatalf("cursor %q is not unpadded base64url", s)
	}
	got, err := decodeCursor(s)
	if err != nil {
		t.Fatal(err)
	}
	if !got.CreatedAt.Equal(c.CreatedAt) || got.ID != c.ID {
		t.Fatalf("got %+v, want %+v", got, c)
	}
	if got.CreatedAt.Location() != time.UTC {
		t.Fatalf("location = %v, want UTC", got.CreatedAt.Location())
	}
	raw, _ := base64.RawURLEncoding.DecodeString(s)
	if string(raw) != strconv.FormatInt(c.CreatedAt.UnixMilli(), 10)+"|cabc123" {
		t.Fatalf("payload = %q", raw)
	}
}

func TestDecodeCursorRejects(t *testing.T) {
	enc := func(s string) string { return base64.RawURLEncoding.EncodeToString([]byte(s)) }
	cases := map[string]string{
		"not base64":         "!!!",
		"padded base64":      base64.URLEncoding.EncodeToString([]byte("1|abc")),
		"empty":              "",
		"no separator":       enc("1700000000000"),
		"empty id":           enc("1700000000000|"),
		"empty time":         enc("|abc"),
		"time not a number":  enc("yesterday|abc"),
		"time with fraction": enc("1.5|abc"),
		"negative time":      enc("-1|abc"),
		"time overflows":     enc("99999999999999999999|abc"),
		"time beyond 9999":   enc("999999999999999|abc"),
		"extra element":      enc("1700000000000|abc|def"),
		"NUL in id":          enc("1700000000000|a\x00b"),
		"invalid UTF-8 id":   enc("1700000000000|\xff"),
	}
	for name, s := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := decodeCursor(s); err == nil {
				t.Fatalf("decodeCursor(%q) accepted", s)
			}
		})
	}
}
