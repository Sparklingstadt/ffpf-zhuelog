package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/chat"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/httpapi"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/learning"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/line"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/linebot"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// shutdownTimeout stays well under ECS's stop timeout (30 seconds by default)
// between SIGTERM and SIGKILL.
const shutdownTimeout = 8 * time.Second

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := LoadConfig(os.Getenv)
	if err != nil {
		fmt.Fprintln(os.Stderr, "config:", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, cfg, logger, nil); err != nil {
		logger.Error("server stopped", "error", err.Error())
		stop()
		os.Exit(1)
	}
}

// newNoRedirectHTTPClient builds a client for a third-party API. It never
// follows redirects, so a request body or header that carries a secret cannot
// be replayed to a redirect target.
func newNoRedirectHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// newGitHubHTTPClient builds the client used to talk to GitHub.
func newGitHubHTTPClient() *http.Client {
	return newNoRedirectHTTPClient(10 * time.Second)
}

// memberChecker is the part of *store.Store ownerValid needs.
type memberChecker interface {
	MemberExists(ctx context.Context, ownerID string) (bool, error)
}

// ownerValid reports whether a linked owner may still use the LINE bot: an
// admin must still be on the allowlist and a member must still exist. Any
// other role (guests included) is never valid.
func ownerValid(allow auth.Allowlist, members memberChecker) linebot.OwnerCheck {
	return func(ctx context.Context, ownerID, role string) (bool, error) {
		switch role {
		case auth.RoleAdmin:
			return allow.Allows(ownerID), nil
		case auth.RoleMember:
			return members.MemberExists(ctx, ownerID)
		}
		return false, nil
	}
}

// newLineService wires the LINE bot: OpenAI for the text, LINE for the
// messages. Both clients refuse redirects because their requests carry keys.
// OpenAI's own 20 s limit applies per generation.
func newLineService(cfg Config, db *store.Store, allow auth.Allowlist, logger *slog.Logger) *linebot.Service {
	return &linebot.Service{
		Store: db,
		Generator: &learning.OpenAI{
			HTTP:    newNoRedirectHTTPClient(20 * time.Second),
			BaseURL: cfg.OpenAIBaseURL,
			APIKey:  cfg.OpenAIAPIKey,
		},
		Messenger: &line.Client{
			HTTP:        newNoRedirectHTTPClient(10 * time.Second),
			BaseURL:     cfg.LineAPIBaseURL,
			AccessToken: cfg.LineChannelAccessToken,
		},
		OwnerValid: ownerValid(allow, db),
		Logger:     logger,
	}
}

// run serves the API until ctx is cancelled, then shuts down gracefully. When
// ready is non-nil, the listening address is sent on it once the listener is
// open.
func run(ctx context.Context, cfg Config, logger *slog.Logger, ready chan<- string) error {
	db, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	// Build the dummy hash now so the first unknown-user login after a cold
	// start costs the same as every other failed login.
	passwords := &auth.PasswordVerifier{}
	passwords.Warm()

	githubHTTP := newGitHubHTTPClient()
	githubApps := auth.GitHubApps{{
		HTTP:         githubHTTP,
		ClientID:     cfg.GitHubClientID,
		ClientSecret: cfg.GitHubClientSecret,
		RedirectURI:  cfg.GitHubRedirectURI,
		Logger:       logger,
	}}
	if cfg.GitHubWebClientID != "" {
		githubApps = append(githubApps, &auth.GitHubClient{
			HTTP:         githubHTTP,
			ClientID:     cfg.GitHubWebClientID,
			ClientSecret: cfg.GitHubWebClientSecret,
			RedirectURI:  cfg.GitHubWebRedirectURI,
			Logger:       logger,
		})
	}

	allowlist := auth.ParseAllowlist(cfg.AllowedGitHubIDs)
	service := &auth.Service{
		Store:     db,
		Signer:    auth.NewSigner(cfg.JWTSecret, time.Now),
		GitHub:    githubApps,
		Allowlist: allowlist,
		Passwords: passwords,
	}
	deps := httpapi.Deps{
		Auth:     service,
		Entries:  db,
		Follows:  db,
		Accounts: db,
		Hasher:   passwords,
		DB:       db,
		Logger:   logger,

		WebProxySecret: cfg.WebProxySecret,
	}
	// Without the LINE settings the routes stay unregistered (404). Line is
	// assigned only here so it is a nil interface, not a nil *linebot.Service.
	if cfg.LineEnabled() {
		deps.Line = newLineService(cfg, db, allowlist, logger)
		deps.LineChannelSecret = cfg.LineChannelSecret
		deps.CronSecret = cfg.CronSecret
	}
	if cfg.ChatEnabled() {
		// The client's limit sits above the streamer's own 60 s one.
		deps.Chat = &chat.Streamer{
			HTTP:    newNoRedirectHTTPClient(65 * time.Second),
			BaseURL: cfg.OpenAIBaseURL,
			APIKey:  cfg.OpenAIAPIKey,
			Model:   cfg.OpenAIChatModel,
		}
		deps.Conversations = db
		deps.ChatModel = cfg.OpenAIChatModel
	}
	handler := httpapi.NewRouter(deps)

	ln, err := net.Listen("tcp", ":"+cfg.Port)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve(ln) }()

	logger.Info("listening", "addr", ln.Addr().String())
	if ready != nil {
		select {
		case ready <- ln.Addr().String():
		case <-ctx.Done():
		}
	}

	select {
	case err := <-serveErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Warn("graceful shutdown incomplete", "error", err.Error())
		_ = srv.Close()
	}
	<-serveErr
	return nil
}
