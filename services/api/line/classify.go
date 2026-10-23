package line

import (
	"unicode"
	"unicode/utf8"
)

// MaxTextRunes is the longest message accepted for correction or translation.
const MaxTextRunes = 500

// Route says what to do with an incoming text.
type Route int

const (
	// RouteCorrection: Chinese text to correct.
	RouteCorrection Route = iota
	// RouteTranslation: Japanese text to translate into Chinese.
	RouteTranslation
	// RouteTooLong: more than MaxTextRunes runes.
	RouteTooLong
	// RouteUnsupported: neither Japanese nor Chinese text.
	RouteUnsupported
)

// Classify routes text. Length is counted in runes (an emoji is one), checked
// first. Any Hiragana or Katakana means Japanese (translate); otherwise any Han
// means Chinese (correct); otherwise the text is unsupported.
func Classify(text string) Route {
	if utf8.RuneCountInString(text) > MaxTextRunes {
		return RouteTooLong
	}
	hasHan := false
	for _, r := range text {
		switch {
		case unicode.Is(unicode.Hiragana, r), unicode.Is(unicode.Katakana, r):
			return RouteTranslation
		case unicode.Is(unicode.Han, r):
			hasHan = true
		}
	}
	if hasHan {
		return RouteCorrection
	}
	return RouteUnsupported
}
