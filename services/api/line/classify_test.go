package line

import (
	"strings"
	"testing"
)

func TestClassify(t *testing.T) {
	// 499 Han characters plus one emoji (4 bytes, 1 rune) is exactly 500 runes.
	exact500 := strings.Repeat("漢", 499) + "😀"
	tests := []struct {
		name string
		text string
		want Route
	}{
		{"chinese", "我喜欢学习", RouteCorrection},
		{"japanese with hiragana", "今日は雨", RouteTranslation},
		{"katakana only", "カタカナ", RouteTranslation},
		{"kanji and katakana", "漢字カナ", RouteTranslation},
		{"latin", "hello", RouteUnsupported},
		{"empty", "", RouteUnsupported},
		{"digits and punctuation", "123 !?", RouteUnsupported},
		{"500 runes with emoji", exact500, RouteCorrection},
		{"501 runes", exact500 + "字", RouteTooLong},
		{"501 latin runes is too long first", strings.Repeat("a", 501), RouteTooLong},
		{"long japanese is too long first", strings.Repeat("あ", 501), RouteTooLong},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Classify(tt.text); got != tt.want {
				t.Fatalf("Classify = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestMaxTextRunes(t *testing.T) {
	if MaxTextRunes != 500 {
		t.Fatalf("MaxTextRunes = %d", MaxTextRunes)
	}
}
