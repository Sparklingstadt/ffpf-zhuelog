package main

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T) string {
	t.Helper()
	path, err := filepath.Abs("../../tests/fixtures/codex-app-server.mjs")
	if err != nil {
		t.Fatal(err)
	}
	return path
}
func TestCodexProtocolAndIsolation(t *testing.T) {
	t.Setenv("DATABASE_URL", "must-not-leak")
	t.Setenv("OPENAI_API_KEY", "must-not-leak")
	t.Setenv("CODEX_ACCESS_TOKEN", "must-not-leak")
	c, err := correctText(context.Background(), fixture(t), "今天我很busy。")
	if err != nil {
		t.Fatal(err)
	}
	if c.CorrectedText != "今天我很忙。" {
		t.Fatal("wrong correction")
	}
}
func TestCodexFailsClosed(t *testing.T) {
	for _, scenario := range []string{"tool", "failure", "exit", "long"} {
		t.Run(scenario, func(t *testing.T) {
			if _, err := runCodex(context.Background(), fixture(t), scenario); err == nil {
				t.Fatal("accepted unsafe response")
			}
		})
	}
}

func TestCodexRejectsUnsafeHandshake(t *testing.T) {
	source, err := os.ReadFile(fixture(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct{ name, before, after string }{
		{"version", "codex/0.155.0-alpha.9.2", "codex/unknown"},
		{"account", `type: "chatgpt"`, `type: "apiKey"`},
		{"plan", `planType: "business"`, `planType: "unknown"`},
		{"model", `model: "gpt-5.6-sol"`, `model: "wrong-model"`},
		{"sandbox", `type: "readOnly"`, `type: "dangerFullAccess"`},
		{"mcp", `inherited: { enabled: true }`, `"unsafe.name": { enabled: true }`},
		{"tool-item", `type: "unused"`, `type: "unused"`},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			modified := strings.Replace(string(source), scenario.before, scenario.after, 1)
			if scenario.name == "tool-item" {
				modified = strings.Replace(string(source), `const text = params.input[0].text;`, `send({method:"item/started",params:{item:{type:"commandExecution"}}}); const text = params.input[0].text;`, 1)
			}
			path := filepath.Join(t.TempDir(), "fixture.mjs")
			if err := os.WriteFile(path, []byte(modified), 0700); err != nil {
				t.Fatal(err)
			}
			if _, err := correctText(context.Background(), path, "今天很好"); err == nil {
				t.Fatal("unsafe handshake accepted")
			}
		})
	}
}

// Opt-in only: consumes one small Business turn, never polls the queue or writes a note.
func TestLiveCodex(t *testing.T) {
	if os.Getenv("ZHUELOG_LIVE_CODEX_TEST") != "1" {
		t.Skip("live verification is opt-in")
	}
	bin := os.Getenv("CODEX_LOCAL_BIN")
	if bin == "" {
		t.Fatal("set CODEX_LOCAL_BIN explicitly")
	}
	if _, err := correctText(context.Background(), bin, "今天我很busy。"); err != nil {
		t.Fatal(err)
	}
}
func TestCodexCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	if _, err := runCodex(ctx, fixture(t), "hang"); err == nil {
		t.Fatal("must cancel")
	}
	ctx, cancel = context.WithCancel(context.Background())
	cancel()
	if _, err := runCodex(ctx, "/must-not-execute", "hello"); err == nil {
		t.Fatal("pre-abort must fail")
	}
}
func TestCorrectionBounds(t *testing.T) {
	for _, output := range []string{
		`{"correctedText":"a","pinyin":"b","hints":["c"],"extra":true}`,
		`{"correctedText":"a","pinyin":"b","hints":[]}`,
		`{"correctedText":" ","pinyin":"b","hints":["c"]}`,
		`{"correctedText":"a","pinyin":"b","hints":["c"]} {}`,
		`{"correctedText":"` + strings.Repeat("😀", 501) + `","pinyin":"b","hints":["c"]}`,
	} {
		if _, err := parseCorrection(output); err == nil {
			t.Fatal("accepted invalid output")
		}
	}
}
func TestPromptAndSecurityParity(t *testing.T) {
	data, err := os.ReadFile("../../src/domain/learning/chinese-correction.ts")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "`"+correctionInstructions+"`") {
		t.Fatal("correction prompt drift")
	}
	data, err = os.ReadFile("../../src/infrastructure/chat/codex-local-client.ts")
	if err != nil {
		t.Fatal(err)
	}
	block := regexp.MustCompile(`(?s)const DISABLED_FEATURES = \[(.*?)\];`).FindStringSubmatch(string(data))
	if len(block) != 2 {
		t.Fatal("missing TS feature list")
	}
	features := regexp.MustCompile(`"([a-z_0-9]+)"`).FindAllStringSubmatch(block[1], -1)
	var ts, goFeatures []string
	for _, f := range features {
		ts = append(ts, "features."+f[1]+"=false")
	}
	for _, arg := range codexArgs() {
		if strings.HasPrefix(arg, "features.") && strings.HasSuffix(arg, "=false") {
			goFeatures = append(goFeatures, arg)
		}
	}
	if !reflect.DeepEqual(ts, goFeatures) {
		t.Fatal("disabled features drift")
	}
	if !strings.Contains(string(data), `"`+testedCodexVersion+`"`) {
		t.Fatal("protocol version drift")
	}
}
