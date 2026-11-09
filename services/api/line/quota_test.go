package line

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func quotaServer(t *testing.T, quota, consumption string, status int) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("request %s %s auth %q", r.Method, r.URL.Path, r.Header.Get("Authorization"))
		}
		w.WriteHeader(status)
		switch r.URL.Path {
		case "/v2/bot/message/quota":
			_, _ = w.Write([]byte(quota))
		case "/v2/bot/message/quota/consumption":
			_, _ = w.Write([]byte(consumption))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	t.Cleanup(srv.Close)
	return &Client{HTTP: srv.Client(), BaseURL: srv.URL, AccessToken: "tok"}
}

func TestPushQuota(t *testing.T) {
	cases := []struct {
		name, quota, consumption string
		want                     Quota
	}{
		{"limited", `{"type":"limited","value":200}`, `{"totalUsage":185}`, Quota{Remaining: 15}},
		{"used up", `{"type":"limited","value":200}`, `{"totalUsage":230}`, Quota{Remaining: 0}},
		{"unlimited", `{"type":"none"}`, ``, Quota{Unlimited: true}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := quotaServer(t, tc.quota, tc.consumption, http.StatusOK).PushQuota(context.Background())
			if err != nil || got != tc.want {
				t.Fatalf("PushQuota = %+v, %v; want %+v", got, err, tc.want)
			}
		})
	}
}

func TestPushQuotaFailures(t *testing.T) {
	for name, c := range map[string]*Client{
		"status":         quotaServer(t, `{}`, `{}`, http.StatusInternalServerError),
		"unknown type":   quotaServer(t, `{"type":"other"}`, `{}`, http.StatusOK),
		"no consumption": quotaServer(t, `{"type":"limited","value":200}`, `{}`, http.StatusOK),
		"not json":       quotaServer(t, `nope`, `{}`, http.StatusOK),
	} {
		if _, err := c.PushQuota(context.Background()); err == nil {
			t.Errorf("%s: want an error", name)
		}
	}
}
