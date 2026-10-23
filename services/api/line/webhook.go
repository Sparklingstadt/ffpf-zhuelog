package line

import "encoding/json"

// Event is one message event from a webhook delivery.
type Event struct {
	WebhookEventID string
	ReplyToken     string
	UserID         string
	Text           string
	IsText         bool // message.type == "text"; Text is empty otherwise
	FromUser       bool // source.type == "user" (not a group or room)
}

type webhookPayload struct {
	Events []struct {
		Type           string `json:"type"`
		WebhookEventID string `json:"webhookEventId"`
		ReplyToken     string `json:"replyToken"`
		Source         struct {
			Type   string `json:"type"`
			UserID string `json:"userId"`
		} `json:"source"`
		Message struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"message"`
	} `json:"events"`
}

// ParseWebhook decodes a webhook body and returns its message events. Other
// event types (follow, unfollow, ...) are dropped. The result is never nil on
// success, so LINE's "verify" delivery (events: []) yields an empty slice.
func ParseWebhook(body []byte) ([]Event, error) {
	var p webhookPayload
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, err
	}
	out := make([]Event, 0, len(p.Events))
	for _, e := range p.Events {
		if e.Type != "message" {
			continue
		}
		ev := Event{
			WebhookEventID: e.WebhookEventID,
			ReplyToken:     e.ReplyToken,
			UserID:         e.Source.UserID,
			IsText:         e.Message.Type == "text",
			FromUser:       e.Source.Type == "user",
		}
		if ev.IsText {
			ev.Text = e.Message.Text
		}
		out = append(out, ev)
	}
	return out, nil
}
