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

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/httpapi"
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

// run serves the API until ctx is cancelled, then shuts down gracefully. When
// ready is non-nil, the listening address is sent on it once the listener is
// open.
func run(ctx context.Context, cfg Config, logger *slog.Logger, ready chan<- string) error {
	db, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	handler := httpapi.NewRouter(httpapi.Deps{DB: db, Logger: logger})

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
