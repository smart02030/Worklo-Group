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

	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/worklo/escrow-service/internal/config"
	"github.com/worklo/escrow-service/internal/handler"
	"github.com/worklo/escrow-service/internal/middleware"
	"github.com/worklo/escrow-service/internal/observability"
	"github.com/worklo/escrow-service/internal/repository"
	"github.com/worklo/escrow-service/internal/service"
	"github.com/worklo/escrow-service/internal/transfer"
)

// loadDotEnv loads the repo-root .env.local for development convenience.
// Candidates are tried one at a time because godotenv.Load aborts on the first
// missing file; which one applies depends on where `go run` was invoked from.
func loadDotEnv() {
	for _, path := range []string{".env.local", "../.env.local", "../../.env.local"} {
		if err := godotenv.Load(path); err == nil {
			return
		}
	}
	// none found: deployments inject env vars directly, and config.Load reports
	// anything genuinely missing
}

func main() {
	if err := run(); err != nil {
		// Nothing structured is guaranteed to exist this early, so fail plainly.
		_, _ = os.Stderr.WriteString("fatal: " + err.Error() + "\n")
		os.Exit(1)
	}
}

func run() error {
	loadDotEnv()

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := observability.NewLogger(
		observability.ParseLevel(cfg.LogLevel), "escrow-service", cfg.Version)

	repo := repository.New(cfg.SupabaseURL, cfg.SupabaseKey, cfg.UpstreamTimeout)
	svc := service.New(repo, transfer.Logging{Logger: logger}, logger, cfg.TransferTimeout)
	h := handler.New(svc, logger)

	r := mux.NewRouter()
	r.NotFoundHandler = http.HandlerFunc(h.NotFound)
	r.MethodNotAllowedHandler = http.HandlerFunc(h.MethodNotAllowed)

	r.HandleFunc("/healthz", h.Health).Methods(http.MethodGet)
	r.HandleFunc("/escrow", h.CreateEscrow).Methods(http.MethodPost)
	r.HandleFunc("/escrow/{id}", h.GetEscrow).Methods(http.MethodGet)
	r.HandleFunc("/escrow/{id}/approve-milestone", h.ApproveMilestone).Methods(http.MethodPost)
	r.HandleFunc("/escrow/{id}/claim-milestone", h.ClaimMilestone).Methods(http.MethodPost)
	r.HandleFunc("/project/{projectId}/escrow", h.GetEscrowByProject).Methods(http.MethodGet)

	// Wrap the router, not r.Use: mux applies route middleware only to MATCHED
	// routes, so unrouted 404s/405s would get no request ID and no access log.
	// RequestID outermost so the access log and any panic carry an ID.
	var handlerChain http.Handler = r
	handlerChain = middleware.Recover(logger)(handlerChain)
	handlerChain = middleware.AccessLog(logger)(handlerChain)
	handlerChain = middleware.RequestID(handlerChain)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      handlerChain,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
	}

	// Trap signals before the listener opens, so a SIGTERM arriving during a
	// slow startup is still handled rather than killing the process outright.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Bind before logging "listening", so a port conflict cannot produce a
	// "listening" line immediately followed by a bind failure.
	listener, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		return fmt.Errorf("cannot bind %s: %w", srv.Addr, err)
	}

	// version is already on every line via the base logger.
	logger.Info("escrow-service listening", slog.String("addr", srv.Addr))

	serveErr := make(chan error, 1)
	go func() {
		if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
		logger.Info("shutdown signal received; draining in-flight requests",
			slog.Duration("grace", cfg.ShutdownGrace))
	}

	// Stops accepting new connections and waits for in-flight handlers; only
	// requests still running after the grace period are abandoned.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownGrace)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown timed out; some requests were dropped",
			slog.String("error", err.Error()))
		return err
	}

	logger.Info("shutdown complete")
	return nil
}
