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
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/httpclient"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// shutdownTimeout is how long in-flight requests get after SIGTERM. It stays
// short so a container runtime (see Dockerfile) does not SIGKILL first; on
// Vercel the platform manages the process instead.
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
// follows redirects, so a request body or header that carries a secret cannot
// be replayed to a redirect target.
func newGitHubHTTPClient() *http.Client {
	return httpclient.NoRedirect(nil, 10*time.Second)
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

	service := &auth.Service{
		Store:     db,
		Signer:    auth.NewSigner(cfg.JWTSecret, time.Now),
		GitHub:    githubApps,
		Allowlist: auth.ParseAllowlist(cfg.AllowedGitHubIDs),
		Passwords: passwords,

		DemoLoginID: cfg.DemoLoginID,
	}
	// Without the FFPF ID settings POST /v1/auth/ffpf answers 503. FFPF is
	// assigned only here so it is a nil interface, not a nil *auth.FFPFClient.
	// The client refuses redirects itself (its token request carries the
	// client secret).
	if cfg.FFPFEnabled() {
		service.FFPF = &auth.FFPFClient{
			HTTP:         &http.Client{Timeout: 10 * time.Second},
			Issuer:       cfg.FFPFIssuer,
			ClientID:     cfg.FFPFClientID,
			ClientSecret: cfg.FFPFClientSecret,
			RedirectURI:  cfg.FFPFRedirectURI,
			Logger:       logger,
		}
	}
	deps := httpapi.Deps{
		Auth:   service,
		DB:     db,
		Logger: logger,

		WebProxySecret: cfg.WebProxySecret,
		Throttle:       db,
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
