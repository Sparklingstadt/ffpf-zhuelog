package line

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestFormatResultCorrection(t *testing.T) {
	got := FormatResult("correction", "我喜欢学汉语", "我喜欢学习汉语", "wǒ xǐhuan xuéxí hànyǔ", []string{"「学」は「学习」にする", "語順は自然"})
	want := "【元の文】\n我喜欢学汉语\n\n" +
		"【添削後】\n我喜欢学习汉语\n\n" +
		"【ピン音】\nwǒ xǐhuan xuéxí hànyǔ\n\n" +
		"【ヒント】\n・「学」は「学习」にする\n・語順は自然\n\n" +
		"学習ノートに保存しました"
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestFormatResultTranslationHeading(t *testing.T) {
	got := FormatResult("translation", "今日は雨", "今天下雨", "jīntiān xiàyǔ", []string{"ヒント"})
	for _, h := range []string{"【元の文】", "【中国語訳】", "【ピン音】", "【ヒント】", "学習ノートに保存しました"} {
		if !strings.Contains(got, h) {
			t.Fatalf("missing %q in:\n%s", h, got)
		}
	}
	if strings.Contains(got, "【添削後】") {
		t.Fatalf("translation reply has correction heading:\n%s", got)
	}
}

func TestFormatResultOmitsEmptySections(t *testing.T) {
	got := FormatResult("correction", "a", "b", "", nil)
	if strings.Contains(got, "【ピン音】") || strings.Contains(got, "【ヒント】") {
		t.Fatalf("empty sections rendered:\n%s", got)
	}
	if !strings.HasSuffix(got, "学習ノートに保存しました") {
		t.Fatalf("missing footer:\n%s", got)
	}
}

func TestFormatResultFitsOneMessageAtMaxSizes(t *testing.T) {
	original := strings.Repeat("あ", 500)
	text := strings.Repeat("字", 1000)
	pinyin := strings.Repeat("ǎ", 1600)
	hint := strings.Repeat("ヒ", 200)
	hints := []string{hint, hint, hint, hint, hint}
	for _, kind := range []string{"correction", "translation"} {
		got := FormatResult(kind, original, text, pinyin, hints)
		if n := utf8.RuneCountInString(got); n > maxMessageRunes {
			t.Fatalf("%s: %d runes > %d", kind, n, maxMessageRunes)
		}
		if !strings.Contains(got, text) || !strings.Contains(got, pinyin) || !strings.HasSuffix(got, "学習ノートに保存しました") {
			t.Fatalf("%s: content was cut at the documented maximum", kind)
		}
	}
}

func TestFormatResultClampsOversizedInput(t *testing.T) {
	huge := strings.Repeat("字", 20000)
	got := FormatResult("correction", huge, huge, huge, []string{huge})
	if n := utf8.RuneCountInString(got); n > maxMessageRunes {
		t.Fatalf("%d runes > %d", n, maxMessageRunes)
	}
	if !utf8.ValidString(got) {
		t.Fatal("invalid UTF-8 after clamp")
	}
}

func TestFormatFailure(t *testing.T) {
	c := FormatFailure("correction", "OPENAI_INVALID_RESPONSE")
	if !strings.Contains(c, "添削できませんでした") || !strings.Contains(c, "OPENAI_INVALID_RESPONSE") {
		t.Fatalf("correction failure = %q", c)
	}
	tr := FormatFailure("translation", "OPENAI_RATE_LIMITED")
	if !strings.Contains(tr, "翻訳できませんでした") || !strings.Contains(tr, "OPENAI_RATE_LIMITED") {
		t.Fatalf("translation failure = %q", tr)
	}
	// An unknown code still yields a usable message that carries the code.
	u := FormatFailure("correction", "SOMETHING_NEW")
	if !strings.Contains(u, "添削できませんでした") || !strings.Contains(u, "SOMETHING_NEW") {
		t.Fatalf("unknown code failure = %q", u)
	}
}

func TestMessageConstants(t *testing.T) {
	checks := map[string]struct{ got, sub string }{
		"MsgLinked":    {MsgLinked, "連携しました"},
		"MsgRelinked":  {MsgRelinked, "連携先を切り替えました"},
		"MsgBadCode":   {MsgBadCode, "コードが違うか期限が切れています"},
		"MsgThrottled": {MsgThrottled, "しばらくしてから試してください"},
		"MsgNotLinked": {MsgNotLinked, "/account/line"},
		"MsgLinkGone":  {MsgLinkGone, "連携が切れました"},
		"MsgTooLong":   {MsgTooLong, "500"},
		"MsgUsage":     {MsgUsage, "添削"},
		"MsgSlow":      {MsgSlow, "少し時間がかかっています"},
	}
	for name, c := range checks {
		if !strings.Contains(c.got, c.sub) {
			t.Errorf("%s = %q, want to contain %q", name, c.got, c.sub)
		}
		if utf8.RuneCountInString(c.got) > maxMessageRunes {
			t.Errorf("%s too long", name)
		}
	}
	if !strings.Contains(MsgUsage, "翻訳") {
		t.Errorf("MsgUsage should mention translation: %q", MsgUsage)
	}
}
