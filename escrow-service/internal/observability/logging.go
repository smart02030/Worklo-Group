// Package observability wires request-scoped context into the logs: structured
// JSON, every line carrying its request ID, and that ID echoed to the caller.
package observability

import (
	"context"
	"log/slog"
	"os"
)

type ctxKey struct{}

// requestIDKey is the context key under which the per-request ID is stored.
var requestIDKey = ctxKey{}

// WithRequestID returns a context carrying id.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey, id)
}

// RequestIDFrom returns the request ID in ctx, or "" if there is none.
func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

// contextHandler injects request-scoped fields into every record. Doing it
// here rather than at each call site means a line cannot omit its request ID.
type contextHandler struct {
	slog.Handler
}

func (h contextHandler) Handle(ctx context.Context, r slog.Record) error {
	if id := RequestIDFrom(ctx); id != "" {
		r.AddAttrs(slog.String("request_id", id))
	}
	return h.Handler.Handle(ctx, r)
}

func (h contextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return contextHandler{h.Handler.WithAttrs(attrs)}
}

func (h contextHandler) WithGroup(name string) slog.Handler {
	return contextHandler{h.Handler.WithGroup(name)}
}

// NewLogger builds the service logger: JSON to stdout.
func NewLogger(level slog.Level, service, version string) *slog.Logger {
	base := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})
	return slog.New(contextHandler{base}).With(
		slog.String("service", service),
		slog.String("version", version),
	)
}

// ParseLevel maps a LOG_LEVEL string to a slog level, defaulting to info.
func ParseLevel(s string) slog.Level {
	switch s {
	case "debug", "DEBUG":
		return slog.LevelDebug
	case "warn", "WARN", "warning":
		return slog.LevelWarn
	case "error", "ERROR":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
