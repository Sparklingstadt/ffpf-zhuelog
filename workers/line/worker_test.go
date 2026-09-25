package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestHTTPRedirectAndLimits(t *testing.T) {
	for _, scenario := range []string{"redirect", "large", "malformed", "trailing", "conflict"} {
		t.Run(scenario, func(t *testing.T) {
			redirected := false
			destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected = true }))
			defer destination.Close()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch scenario {
				case "redirect":
					http.Redirect(w, r, destination.URL, 307)
				case "large":
					fmt.Fprint(w, strings.Repeat(" ", 65*1024))
				case "malformed":
					fmt.Fprint(w, `{"job":`)
				case "trailing":
					fmt.Fprint(w, `{} {}`)
				case "conflict":
					w.WriteHeader(409)
				}
			}))
			defer server.Close()
			w := newWorker(config{endpoint: server.URL, token: strings.Repeat("a", 64)})
			r, err := w.call(context.Background(), map[string]any{"action": "claim"})
			if scenario == "conflict" {
				if err != nil || r != nil {
					t.Fatal("409 must lose lease")
				}
			} else if err == nil {
				t.Fatal("expected failure")
			}
			if redirected {
				t.Fatal("followed redirect with token")
			}
		})
	}
}
func TestGenerationFailureIsReportedWithoutCompleting(t *testing.T) {
	var actions []string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var cmd map[string]any
		json.NewDecoder(r.Body).Decode(&cmd)
		actions = append(actions, cmd["action"].(string))
		if cmd["action"] == "claim" {
			fmt.Fprint(w, `{"job":{"id":"test","leaseToken":"11111111-1111-4111-8111-111111111111","phase":"generate","originalText":"今天"}}`)
		} else {
			fmt.Fprint(w, `{"ok":true}`)
		}
	}))
	defer s.Close()
	w := newWorker(config{endpoint: s.URL, codexBin: "/must-not-exist"})
	processed, err := w.step(context.Background())
	if err == nil || processed || !reflect.DeepEqual(actions, []string{"claim", "fail"}) {
		t.Fatal("generation failure handling", actions)
	}
}
func TestJobValidation(t *testing.T) {
	base := job{ID: "test", LeaseToken: "11111111-1111-4111-8111-111111111111", Phase: "deliver"}
	if err := base.validate(); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*job){func(j *job) { j.ID = "bad\nlog" }, func(j *job) { j.LeaseToken = "bad" }, func(j *job) { j.Phase = "execute" }, func(j *job) { j.Phase = "generate" }, func(j *job) { j.OriginalText = strings.Repeat("😀", 251) }} {
		j := base
		mutate(&j)
		if j.validate() == nil {
			t.Fatal("invalid job accepted")
		}
	}
}
