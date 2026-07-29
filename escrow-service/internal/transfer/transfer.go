// Package transfer is the port for moving money out of escrow. An interface
// with a stub implementation: the real provider is out of scope, but where the
// call sits relative to the DB commit is what the guarantees depend on.
package transfer

import (
	"context"
	"log/slog"
)

// Request is one milestone payment. ID is the outbox row's primary key, stable
// across retries — hand it to a provider as the idempotency key.
type Request struct {
	ID             string
	EscrowID       string
	ContractorID   string
	MilestoneIndex int
	AmountCents    int64
}

// Transferrer moves funds for a single milestone. An error means "not known to
// have succeeded" (including timeouts), not "definitely did not happen".
type Transferrer interface {
	Transfer(ctx context.Context, req Request) error
}

// Logging is a stub Transferrer standing in for a real payment provider.
type Logging struct {
	Logger *slog.Logger
}

func (l Logging) Transfer(ctx context.Context, req Request) error {
	l.Logger.InfoContext(ctx, "fund transfer executed",
		slog.String("transfer_id", req.ID),
		slog.String("escrow_id", req.EscrowID),
		slog.String("contractor_id", req.ContractorID),
		slog.Int("milestone_index", req.MilestoneIndex),
		slog.Int64("amount_cents", req.AmountCents),
	)
	return nil
}
