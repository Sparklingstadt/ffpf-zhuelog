package chat

import (
	"errors"
	"strings"
	"testing"
)

func TestValidate(t *testing.T) {
	user := func(text string) Message { return Message{Role: "user", Text: text} }
	assistant := func(text string) Message { return Message{Role: "assistant", Text: text} }
	alternating := func(n int) []Message {
		out := make([]Message, n)
		for i := range out {
			out[i] = assistant("好")
			if i%2 == 0 {
				out[i] = user("你")
			}
		}
		return out
	}
	forty := alternating(39)
	forty = append(forty, user("你"))

	cases := []struct {
		name string
		msgs []Message
		ok   bool
	}{
		{"none", nil, false},
		{"one user", []Message{user("你好")}, true},
		{"forty ending with user", forty, true},
		{"forty-one", append(alternating(40), user("你")), false},
		{"last is assistant", []Message{user("你好"), assistant("你好！")}, false},
		{"system role", []Message{{Role: "system", Text: "x"}, user("你好")}, false},
		{"blank text", []Message{user(" \n\t")}, false},
		{"40000 chars", []Message{user(strings.Repeat("字", MaxTotalChars))}, true},
		{"40001 chars", []Message{user(strings.Repeat("字", MaxTotalChars-1)), assistant("好"), user("你")}, false},
	}
	for _, tc := range cases {
		err := Validate(tc.msgs)
		if tc.ok && err != nil {
			t.Errorf("%s: err = %v", tc.name, err)
		}
		if !tc.ok && !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", tc.name, err)
		}
	}
}
