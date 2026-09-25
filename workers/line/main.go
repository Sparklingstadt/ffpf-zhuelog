package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"syscall"
	"time"
	"unicode/utf16"
)

type job struct {
	ID           string `json:"id"`
	LeaseToken   string `json:"leaseToken"`
	Phase        string `json:"phase"`
	OriginalText string `json:"originalText"`
}
type response struct {
	Job     *job  `json:"job"`
	OK      bool  `json:"ok"`
	Allowed *bool `json:"allowed"`
}

var uuid = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
var safeID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)

func jsLen(s string) int { return len(utf16.Encode([]rune(s))) }

func (j job) validate() error {
	if !safeID.MatchString(j.ID) || !uuid.MatchString(j.LeaseToken) || jsLen(j.OriginalText) > 500 {
		return errors.New("invalid job")
	}
	switch j.Phase {
	case "generate", "issue":
		if j.OriginalText == "" {
			return errors.New("missing text")
		}
	case "battery", "deliver":
	default:
		return errors.New("unknown job phase")
	}
	return nil
}

func newHTTPClient() *http.Client {
	return &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect refused") }}
}

// Bounded JSON decoding rejects extra trailing content, never logs response bodies.
func readJSON(r io.Reader, limit int64, out any) error {
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil || int64(len(data)) > limit {
		return errors.New("response exceeds limit")
	}
	return json.Unmarshal(data, out)
}

type worker struct {
	c       config
	client  *http.Client
	correct func(context.Context, string) (correction, error)
	battery func(context.Context) (map[string]any, error)
	publish func(context.Context, job, func() (*bool, error)) (*issueResult, error)
}

func newWorker(c config) *worker {
	w := &worker{c: c, client: newHTTPClient(), battery: readBattery}
	w.correct = func(ctx context.Context, text string) (correction, error) { return correctText(ctx, c.codexBin, text) }
	w.publish = func(ctx context.Context, j job, permit func() (*bool, error)) (*issueResult, error) {
		return publishLocal(ctx, c.ghBin, j, permit)
	}
	return w
}
func (w *worker) call(ctx context.Context, command map[string]any) (*response, error) {
	data, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.c.endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+w.c.token)
	req.Header.Set("Content-Type", "application/json")
	r, err := w.client.Do(req)
	if err != nil {
		return nil, errors.New("worker request failed")
	}
	defer r.Body.Close()
	if r.StatusCode == 409 {
		return nil, nil
	}
	if r.StatusCode < 200 || r.StatusCode >= 300 {
		return nil, errors.New("worker HTTP error")
	}
	var result response
	if err = readJSON(r.Body, 64*1024, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
func (w *worker) step(ctx context.Context) (bool, error) {
	capabilities := []string{"battery"}
	if w.c.development {
		capabilities = append(capabilities, "development")
	}
	r, err := w.call(ctx, map[string]any{"action": "claim", "capabilities": capabilities})
	if err != nil || r == nil || r.Job == nil {
		return false, err
	}
	j := *r.Job
	if err := j.validate(); err != nil {
		return false, err
	}
	command := map[string]any{"id": j.ID, "leaseToken": j.LeaseToken}
	switch j.Phase {
	case "deliver":
		command["action"] = "deliver"
	case "battery":
		report, err := w.battery(ctx)
		if err != nil {
			return false, err
		}
		command["action"], command["report"] = "complete-battery", report
	case "issue":
		if !w.c.development {
			return false, errors.New("development disabled")
		}
		result, err := w.publish(ctx, j, func() (*bool, error) {
			permit, err := w.call(ctx, map[string]any{"action": "begin-issue", "id": j.ID, "leaseToken": j.LeaseToken})
			if err != nil || permit == nil {
				return nil, err
			}
			return permit.Allowed, nil
		})
		if err != nil || result == nil {
			return false, err
		}
		command["action"], command["result"] = "complete-issue", result
	case "generate":
		result, err := w.correct(ctx, j.OriginalText)
		if err != nil {
			if ctx.Err() == nil {
				_, _ = w.call(ctx, map[string]any{"action": "fail", "id": j.ID, "leaseToken": j.LeaseToken})
			}
			return false, errors.New("correction failed")
		}
		command["action"], command["correction"] = "complete", result
	}
	r, err = w.call(ctx, command)
	if err != nil {
		return false, err
	}
	if r != nil && r.OK {
		fmt.Printf("LINE job %s: %s processed\n", j.ID, j.Phase)
	}
	return r != nil && r.OK, nil
}
func (w *worker) run(ctx context.Context, once bool, wait time.Duration) {
	fmt.Println("LINE worker started (Go). Outbound polling only; no listening port.")
	for ctx.Err() == nil {
		processed, err := w.step(ctx)
		if err != nil && ctx.Err() == nil {
			fmt.Fprintln(os.Stderr, "LINE processing failed. Check settings/usage and job status; retries are bounded.")
		}
		if once {
			return
		}
		if processed {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}
func main() {
	once := flag.Bool("once", false, "Process at most one job (may change server state)")
	check := flag.Bool("check", false, "Validate local configuration only; no network or AI")
	flag.Parse()
	if flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "Unexpected arguments")
		os.Exit(2)
	}
	c, err := loadConfig(".")
	if err != nil {
		fmt.Fprintln(os.Stderr, "Invalid local worker configuration; see docs/line-integration.md.")
		os.Exit(1)
	}
	if *check {
		fmt.Println("Worker configuration valid.")
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	newWorker(c).run(ctx, *once, 15*time.Second)
}
