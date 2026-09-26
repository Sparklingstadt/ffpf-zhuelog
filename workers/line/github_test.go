package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIssueDraft(t *testing.T) {
	t.Parallel()
	d, err := makeIssue("job-1", "@user 検索\n![image](https://example.com)\x00")
	if err != nil {
		t.Fatal(err)
	}
	if d.Title != "[改善案] ＠user 検索" || !strings.Contains(d.Body, "    ![image]") || strings.ContainsRune(d.Body, 0) || !strings.HasSuffix(d.Body, d.Marker) {
		t.Fatal("unsafe formatting")
	}
	if _, err := makeIssue("bad -->", "x"); err == nil {
		t.Fatal("unsafe marker")
	}
	if _, err := createdIssue("https://github.com/other/repo/issues/1"); err == nil {
		t.Fatal("foreign repository")
	}
}
func TestIssueReconciliation(t *testing.T) {
	t.Parallel()
	for _, scenario := range []string{"create", "existing", "lost-response", "uncertain", "denied", "lost-lease", "scan-failed", "scan-limit", "invalid-url", "pull-request"} {
		t.Run(scenario, func(t *testing.T) {
			t.Parallel()
			posts, gets, permits := 0, 0, 0
			marker := "<!-- zhuelog-dev:job-1 -->"
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer local-test" {
					t.Error("missing auth")
				}
				w.Header().Set("Content-Type", "application/json")
				if r.Method == "POST" {
					posts++
					if scenario == "lost-response" || scenario == "uncertain" {
						w.WriteHeader(502)
						return
					}
					if scenario == "invalid-url" {
						fmt.Fprint(w, `{"html_url":"https://evil.example/1"}`)
						return
					}
					fmt.Fprint(w, `{"html_url":"https://github.com/Sparklingstadt/ffpf-zhuelog/issues/12"}`)
					return
				}
				gets++
				if scenario == "scan-failed" {
					w.WriteHeader(500)
					return
				}
				if scenario == "scan-limit" {
					json.NewEncoder(w).Encode(make([]githubIssue, 100))
					return
				}
				if scenario == "existing" || (scenario == "lost-response" && posts == 1) || scenario == "pull-request" {
					item := map[string]any{"html_url": "https://github.com/Sparklingstadt/ffpf-zhuelog/issues/11", "body": marker}
					if scenario == "pull-request" {
						item["pull_request"] = map[string]any{}
					}
					json.NewEncoder(w).Encode([]any{item})
					return
				}
				fmt.Fprint(w, `[]`)
			}))
			defer server.Close()
			g := githubClient{token: "local-test", endpoint: server.URL, client: newHTTPClient()}
			result, err := g.publish(context.Background(), job{ID: "job-1", OriginalText: "検索の改善"}, func() (*bool, error) {
				permits++
				if scenario == "lost-lease" {
					return nil, nil
				}
				allowed := scenario != "denied"
				return &allowed, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "lost-lease" {
				if result != nil || posts != 0 {
					t.Fatal("published after lost lease")
				}
				return
			}
			expected := "uncertain"
			if scenario == "create" || scenario == "existing" || scenario == "lost-response" || scenario == "pull-request" {
				expected = "created"
			}
			if result == nil || result.Outcome != expected {
				t.Fatalf("result: %+v", result)
			}
			if posts > 1 {
				t.Fatal("duplicate publication")
			}
			if scenario == "existing" || scenario == "scan-failed" || scenario == "scan-limit" {
				if posts != 0 || permits != 0 {
					t.Fatal("must not publish")
				}
			}
			if scenario == "denied" && posts != 0 {
				t.Fatal("must respect permit")
			}
			if scenario == "scan-limit" && gets != 10 {
				t.Fatal("scan must be bounded")
			}
		})
	}
}
