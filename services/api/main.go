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
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/httpapi"
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

// newGitHubHTTPClient builds the client used to talk to GitHub. It never
// follows redirects, so the POST body (which carries the client secret) cannot
// be replayed to a redirect target.
func newGitHubHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
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

	service := &auth.Service{
		Store:  db,
		Signer: auth.NewSigner(cfg.JWTSecret, time.Now),
		GitHub: &auth.GitHubClient{
			HTTP:         newGitHubHTTPClient(),
			ClientID:     cfg.GitHubClientID,
			ClientSecret: cfg.GitHubClientSecret,
			RedirectURI:  cfg.GitHubRedirectURI,
			Logger:       logger,
		},
		Allowlist: auth.ParseAllowlist(cfg.AllowedGitHubLogins),
		Passwords: passwords,
	}
	handler := httpapi.NewRouter(httpapi.Deps{
		Auth:    service,
		Entries: db,
		DB:      db,
		Logger:  logger,
	})

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
