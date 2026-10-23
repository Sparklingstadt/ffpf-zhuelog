package line

import (
	"reflect"
	"testing"
)

func TestParseWebhookEmptyEvents(t *testing.T) {
	events, err := ParseWebhook([]byte(`{"destination":"U1","events":[]}`))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if events == nil || len(events) != 0 {
		t.Fatalf("events = %#v, want empty non-nil slice", events)
	}
}

func TestParseWebhookMissingEvents(t *testing.T) {
	events, err := ParseWebhook([]byte(`{}`))
	if err != nil || events == nil || len(events) != 0 {
		t.Fatalf("events = %#v, err = %v", events, err)
	}
}

func TestParseWebhookTextFromUser(t *testing.T) {
	body := `{"events":[{"type":"message","webhookEventId":"01ABC","replyToken":"rt","source":{"type":"user","userId":"U123"},"message":{"type":"text","id":"1","text":"我喜欢学习"}}]}`
	events, err := ParseWebhook([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	want := []Event{{WebhookEventID: "01ABC", ReplyToken: "rt", UserID: "U123", Text: "我喜欢学习", IsText: true, FromUser: true}}
	if !reflect.DeepEqual(events, want) {
		t.Fatalf("events = %#v, want %#v", events, want)
	}
}

func TestParseWebhookGroupAndRoomAreNotFromUser(t *testing.T) {
	for _, src := range []string{"group", "room"} {
		body := `{"events":[{"type":"message","webhookEventId":"e","replyToken":"rt","source":{"type":"` + src + `","userId":"U1"},"message":{"type":"text","text":"hi"}}]}`
		events, err := ParseWebhook([]byte(body))
		if err != nil || len(events) != 1 {
			t.Fatalf("%s: events = %#v, err = %v", src, events, err)
		}
		if events[0].FromUser {
			t.Fatalf("%s: FromUser = true", src)
		}
	}
}

func TestParseWebhookStickerIsNotText(t *testing.T) {
	body := `{"events":[{"type":"message","webhookEventId":"e","replyToken":"rt","source":{"type":"user","userId":"U1"},"message":{"type":"sticker","id":"1","packageId":"1","stickerId":"2"}}]}`
	events, err := ParseWebhook([]byte(body))
	if err != nil || len(events) != 1 {
		t.Fatalf("events = %#v, err = %v", events, err)
	}
	if events[0].IsText || events[0].Text != "" {
		t.Fatalf("event = %#v, want non-text", events[0])
	}
}

func TestParseWebhookKeepsOnlyMessageEvents(t *testing.T) {
	body := `{"events":[
		{"type":"follow","replyToken":"a","source":{"type":"user","userId":"U1"}},
		{"type":"message","webhookEventId":"m","replyToken":"b","source":{"type":"user","userId":"U1"},"message":{"type":"text","text":"x"}},
		{"type":"unfollow","source":{"type":"user","userId":"U1"}}
	]}`
	events, err := ParseWebhook([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].WebhookEventID != "m" {
		t.Fatalf("events = %#v", events)
	}
}

func TestParseWebhookMalformed(t *testing.T) {
	for _, body := range []string{``, `{`, `not json`, `{"events":"x"}`} {
		if _, err := ParseWebhook([]byte(body)); err == nil {
			t.Fatalf("body %q: want error", body)
		}
	}
}
