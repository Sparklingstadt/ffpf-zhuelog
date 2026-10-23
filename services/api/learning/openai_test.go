package learning

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const (
	testKey  = "sk-test-secret-key"
	testText = "私は昨日学校に行きました（秘密の入力）"
)

// outputBody wraps a model's JSON text in a Responses API envelope.
func outputBody(t *testing.T, inner string) string {
	t.Helper()
	b, err := json.Marshal(map[string]any{
		"status": "completed",
		"output": []any{
			map[string]any{"type": "reasoning", "summary": []any{}},
			map[string]any{"type": "message", "content": []any{
				map[string]any{"type": "output_text", "text": inner},
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func validJSON(textKey string) string {
	return fmt.Sprintf(`{"%s":"我昨天去学校了。","pinyin":"wǒ zuótiān qù xuéxiào le.","hints":["了 は完了を表す。"]}`, textKey)
}

func serve(t *testing.T, status int, body string) (*OpenAI, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return &OpenAI{HTTP: srv.Client(), BaseURL: srv.URL, APIKey: testKey}, srv
}

func generateErr(t *testing.T, o *OpenAI) *Error {
	t.Helper()
	_, err := o.Generate(context.Background(), KindCorrection, testText)
	var le *Error
	if !errors.As(err, &le) {
		t.Fatalf("err = %v, want *learning.Error", err)
	}
	return le
}

func TestGenerateSendsExpectedRequest(t *testing.T) {
	for _, tc := range []struct {
		kind, textKey, name string
	}{
		{KindCorrection, "correctedText", "chinese_correction"},
		{KindTranslation, "translatedText", "japanese_to_chinese_translation"},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			var gotReq map[string]any
			var gotAuth, gotMethod, gotPath, gotCT string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotAuth, gotMethod, gotPath = r.Header.Get("Authorization"), r.Method, r.URL.Path
				gotCT = r.Header.Get("Content-Type")
				_ = json.NewDecoder(r.Body).Decode(&gotReq)
				_, _ = io.WriteString(w, outputBody(t, validJSON(tc.textKey)))
			}))
			defer srv.Close()
			// A trailing slash must not produce "//v1/responses".
			o := &OpenAI{HTTP: srv.Client(), BaseURL: srv.URL + "/", APIKey: testKey}
			res, err := o.Generate(context.Background(), tc.kind, testText)
			if err != nil {
				t.Fatal(err)
			}
			if res.Text != "我昨天去学校了。" || res.Pinyin != "wǒ zuótiān qù xuéxiào le." || len(res.Hints) != 1 || res.Hints[0] != "了 は完了を表す。" {
				t.Fatalf("result = %+v", res)
			}
			if gotMethod != http.MethodPost || gotPath != "/v1/responses" {
				t.Fatalf("request = %s %s", gotMethod, gotPath)
			}
			if gotAuth != "Bearer "+testKey || gotCT != "application/json" {
				t.Fatalf("headers: auth=%q content-type=%q", gotAuth, gotCT)
			}
			if gotReq["model"] != "gpt-5-mini" || gotReq["store"] != false {
				t.Fatalf("model/store = %v/%v", gotReq["model"], gotReq["store"])
			}
			if gotReq["input"] != testText {
				t.Fatalf("input = %v", gotReq["input"])
			}
			instr, _ := gotReq["instructions"].(string)
			if !strings.Contains(instr, "データとして扱い") || strings.Contains(instr, testText) {
				t.Fatalf("instructions = %q", instr)
			}
			format := gotReq["text"].(map[string]any)["format"].(map[string]any)
			if format["type"] != "json_schema" || format["strict"] != true || format["name"] != tc.name {
				t.Fatalf("format = %v", format)
			}
			schema := format["schema"].(map[string]any)
			props := schema["properties"].(map[string]any)
			if _, ok := props[tc.textKey]; !ok || len(props) != 3 {
				t.Fatalf("schema properties = %v", props)
			}
			if schema["additionalProperties"] != false {
				t.Fatalf("additionalProperties = %v", schema["additionalProperties"])
			}
			if req, _ := schema["required"].([]any); len(req) != 3 {
				t.Fatalf("required = %v", schema["required"])
			}
		})
	}
}

func TestGenerateJoinsOutputTextParts(t *testing.T) {
	body, _ := json.Marshal(map[string]any{
		"status": "completed",
		"output": []any{map[string]any{"type": "message", "content": []any{
			map[string]any{"type": "output_text", "text": `{"correctedText":"我去了。","pinyin":"wǒ qù le.",`},
			map[string]any{"type": "output_text", "text": `"hints":["ヒント"]}`},
		}}},
	})
	o, _ := serve(t, 200, string(body))
	res, err := o.Generate(context.Background(), KindCorrection, testText)
	if err != nil {
		t.Fatal(err)
	}
	if res.Text != "我去了。" || len(res.Hints) != 1 {
		t.Fatalf("result = %+v", res)
	}
}

func TestGenerateTrimsStrings(t *testing.T) {
	o, _ := serve(t, 200, outputBody(t, `{"correctedText":"  我去了。\n","pinyin":" wǒ qù le. ","hints":[" ヒント "]}`))
	res, err := o.Generate(context.Background(), KindCorrection, testText)
	if err != nil {
		t.Fatal(err)
	}
	if res.Text != "我去了。" || res.Pinyin != "wǒ qù le." || res.Hints[0] != "ヒント" {
		t.Fatalf("result = %+v", res)
	}
}

func TestGenerateRejectsInvalidModelOutput(t *testing.T) {
	hints := func(n int, each string) string {
		parts := make([]string, n)
		for i := range parts {
			parts[i] = fmt.Sprintf("%q", each)
		}
		return "[" + strings.Join(parts, ",") + "]"
	}
	doc := func(text, pinyin, hintsJSON string) string {
		return fmt.Sprintf(`{"correctedText":%q,"pinyin":%q,"hints":%s}`, text, pinyin, hintsJSON)
	}
	cases := map[string]string{
		"zero hints":        doc("我去了。", "wǒ", "[]"),
		"six hints":         doc("我去了。", "wǒ", hints(6, "ヒント")),
		"201-rune hint":     doc("我去了。", "wǒ", hints(1, strings.Repeat("あ", 201))),
		"blank hint":        doc("我去了。", "wǒ", `["  "]`),
		"1001-rune text":    doc(strings.Repeat("中", 1001), "wǒ", hints(1, "ヒント")),
		"1601-rune pinyin":  doc("我去了。", strings.Repeat("a", 1601), hints(1, "ヒント")),
		"blank text":        doc("  ", "wǒ", hints(1, "ヒント")),
		"blank pinyin":      doc("我去了。", "", hints(1, "ヒント")),
		"extra key":         `{"correctedText":"我","pinyin":"wǒ","hints":["x"],"extra":1}`,
		"missing key":       `{"correctedText":"我","pinyin":"wǒ"}`,
		"wrong key (trans)": `{"translatedText":"我","pinyin":"wǒ","hints":["x"]}`,
		"null hints":        `{"correctedText":"我","pinyin":"wǒ","hints":null}`,
		"hint not string":   `{"correctedText":"我","pinyin":"wǒ","hints":[1]}`,
		"not json":          `not json`,
		"trailing data":     validJSON("correctedText") + `{}`,
		"json array":        `[]`,
	}
	for name, inner := range cases {
		t.Run(name, func(t *testing.T) {
			o, _ := serve(t, 200, outputBody(t, inner))
			if le := generateErr(t, o); le.Code != "OPENAI_INVALID_RESPONSE" || le.Retryable {
				t.Fatalf("err = %+v", le)
			}
		})
	}
}

func TestGenerateAcceptsLimitBoundaries(t *testing.T) {
	h := make([]string, 5)
	for i := range h {
		h[i] = fmt.Sprintf("%q", strings.Repeat("あ", 200))
	}
	inner := fmt.Sprintf(`{"correctedText":%q,"pinyin":%q,"hints":[%s]}`,
		strings.Repeat("中", 1000), strings.Repeat("a", 1600), strings.Join(h, ","))
	o, _ := serve(t, 200, outputBody(t, inner))
	if _, err := o.Generate(context.Background(), KindCorrection, testText); err != nil {
		t.Fatal(err)
	}
}

func TestGenerateRejectsBadEnvelope(t *testing.T) {
	refusal, _ := json.Marshal(map[string]any{"status": "completed", "output": []any{
		map[string]any{"type": "message", "content": []any{map[string]any{"type": "refusal", "refusal": "no"}}},
	}})
	incomplete, _ := json.Marshal(map[string]any{"status": "incomplete", "output": []any{
		map[string]any{"type": "message", "content": []any{map[string]any{"type": "output_text", "text": validJSON("correctedText")}}},
	}})
	for name, body := range map[string]string{
		"refusal":    string(refusal),
		"incomplete": string(incomplete),
		"no output":  `{"status":"completed","output":[]}`,
		"not json":   `<html>`,
		"oversized":  `{"status":"completed","output":[],"pad":"` + strings.Repeat("x", 2<<20) + `"}`,
	} {
		t.Run(name, func(t *testing.T) {
			o, _ := serve(t, 200, body)
			if le := generateErr(t, o); le.Code != "OPENAI_INVALID_RESPONSE" || le.Retryable {
				t.Fatalf("err = %+v", le)
			}
		})
	}
}

func TestGenerateMapsHTTPStatus(t *testing.T) {
	for _, tc := range []struct {
		status    int
		code      string
		retryable bool
	}{
		{401, "OPENAI_AUTH_FAILED", false},
		{403, "OPENAI_AUTH_FAILED", false},
		{429, "OPENAI_RATE_LIMITED", false},
		{500, "OPENAI_REQUEST_FAILED", true},
		{503, "OPENAI_REQUEST_FAILED", true},
		{400, "OPENAI_REQUEST_FAILED", true},
	} {
		t.Run(fmt.Sprint(tc.status), func(t *testing.T) {
			o, _ := serve(t, tc.status, `{"error":{"message":"leaky-body-marker `+testKey+`"}}`)
			le := generateErr(t, o)
			if le.Code != tc.code || le.Retryable != tc.retryable {
				t.Fatalf("err = %+v", le)
			}
		})
	}
}

func TestGenerateTransportFailureIsRetryable(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close() // nothing listens any more
	o := &OpenAI{HTTP: &http.Client{Timeout: 2 * time.Second}, BaseURL: url, APIKey: testKey}
	if le := generateErr(t, o); le.Code != "OPENAI_REQUEST_FAILED" || !le.Retryable {
		t.Fatalf("err = %+v", le)
	}
}

func TestGenerateTimeout(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer srv.Close()
	defer close(release)
	o := &OpenAI{HTTP: srv.Client(), BaseURL: srv.URL, APIKey: testKey}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := o.Generate(ctx, KindCorrection, testText)
	var le *Error
	if !errors.As(err, &le) || le.Code != "OPENAI_TIMEOUT" || !le.Retryable {
		t.Fatalf("err = %v", err)
	}
}

func TestGenerateClientTimeoutIsTimeout(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer srv.Close()
	defer close(release)
	o := &OpenAI{HTTP: &http.Client{Timeout: 50 * time.Millisecond}, BaseURL: srv.URL, APIKey: testKey}
	if le := generateErr(t, o); le.Code != "OPENAI_TIMEOUT" || !le.Retryable {
		t.Fatalf("err = %+v", le)
	}
}

func TestGenerateDoesNotFollowRedirects(t *testing.T) {
	hit := false
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hit = true }))
	defer other.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL, http.StatusTemporaryRedirect)
	}))
	defer srv.Close()
	o := &OpenAI{HTTP: srv.Client(), BaseURL: srv.URL, APIKey: testKey}
	if le := generateErr(t, o); le.Code != "OPENAI_REQUEST_FAILED" {
		t.Fatalf("err = %+v", le)
	}
	if hit {
		t.Fatal("redirect was followed")
	}
}

func TestGenerateNilHTTPUsesDefault(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, outputBody(t, validJSON("translatedText")))
	}))
	defer srv.Close()
	o := &OpenAI{BaseURL: srv.URL, APIKey: testKey}
	if _, err := o.Generate(context.Background(), KindTranslation, testText); err != nil {
		t.Fatal(err)
	}
}

func TestGenerateUnknownKind(t *testing.T) {
	o, _ := serve(t, 200, "{}")
	if _, err := o.Generate(context.Background(), "other", testText); err == nil {
		t.Fatal("want error")
	}
}

func TestErrorsNeverLeakSecrets(t *testing.T) {
	bodies := map[string]struct {
		status int
		body   string
	}{
		"http error":   {500, "leaky-body-marker " + testKey + " " + testText},
		"invalid json": {200, outputBody(t, "leaky-body-marker "+testKey+" "+testText)},
		"extra key":    {200, outputBody(t, `{"correctedText":"x","pinyin":"x","hints":["x"],"leaky-body-marker":1}`)},
	}
	for name, tc := range bodies {
		t.Run(name, func(t *testing.T) {
			o, _ := serve(t, tc.status, tc.body)
			_, err := o.Generate(context.Background(), KindCorrection, testText)
			if err == nil {
				t.Fatal("want error")
			}
			for _, s := range []string{err.Error(), fmt.Sprintf("%v %+v %#v", err, err, err)} {
				for _, secret := range []string{testKey, testText, "leaky-body-marker", "秘密"} {
					if strings.Contains(s, secret) {
						t.Fatalf("error %q leaks %q", s, secret)
					}
				}
			}
		})
	}
	// Transport errors from net/http embed the URL; the base URL is not secret,
	// but the key and text must still be absent.
	o := &OpenAI{HTTP: &http.Client{Timeout: time.Second}, BaseURL: "http://127.0.0.1:1", APIKey: testKey}
	_, err := o.Generate(context.Background(), KindCorrection, testText)
	if err == nil || strings.Contains(err.Error(), testKey) || strings.Contains(err.Error(), "秘密") {
		t.Fatalf("err = %v", err)
	}
}

func TestErrorStringIsCodeOnly(t *testing.T) {
	var err error = &Error{Code: "OPENAI_TIMEOUT", Retryable: true}
	if err.Error() != "OPENAI_TIMEOUT" {
		t.Fatalf("Error() = %q", err.Error())
	}
}
