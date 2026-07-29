package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/worklo/escrow-service/internal/apperr"
	"github.com/worklo/escrow-service/internal/model"
	"github.com/worklo/escrow-service/internal/transfer"
)

// Repository is the persistence port. An interface, so the service layer is
// testable with an in-memory fake and no database.
type Repository interface {
	Create(ctx context.Context, e *model.Escrow) (*model.Escrow, error)
	GetByID(ctx context.Context, id string) (*model.Escrow, error)
	GetByProjectID(ctx context.Context, projectID string) (*model.Escrow, error)
	ApproveMilestone(ctx context.Context, id, callerID string) (*model.MutationResult, error)
	ClaimMilestone(ctx context.Context, id, callerID string) (*model.MutationResult, error)
	SettleTransfer(ctx context.Context, transferID string, status model.TransferStatus, lastErr string) error
}

// Service contains the business logic for escrow operations.
type Service struct {
	repo     Repository
	transfer transfer.Transferrer
	logger   *slog.Logger
	// bounds a payment attempt independently of the request's deadline
	transferTimeout time.Duration
}

// New creates a Service backed by repo.
func New(repo Repository, tr transfer.Transferrer, logger *slog.Logger, transferTimeout time.Duration) *Service {
	return &Service{repo: repo, transfer: tr, logger: logger, transferTimeout: transferTimeout}
}

// CreateEscrow validates the request and creates a new active escrow.
func (s *Service) CreateEscrow(ctx context.Context, req model.CreateEscrowRequest) (*model.Escrow, error) {
	if err := validateCreate(req); err != nil {
		return nil, err
	}

	escrow := &model.Escrow{
		ID:                 uuid.New().String(),
		ProjectID:          req.ProjectID,
		ClientID:           req.ClientID,
		ContractorID:       req.ContractorID,
		TotalMilestones:    req.TotalMilestones,
		MilestonesApproved: 0,
		MilestonesClaimed:  0,
		AmountPerMilestone: req.AmountPerMilestone,
		Status:             model.StatusActive,
		CreatedAt:          time.Now().UTC(),
	}

	created, err := s.repo.Create(ctx, escrow)
	if err != nil {
		return nil, err
	}

	s.logger.InfoContext(ctx, "escrow created",
		slog.String("escrow_id", created.ID),
		slog.String("project_id", created.ProjectID),
		slog.Int("total_milestones", created.TotalMilestones),
		slog.Int64("amount_per_milestone", created.AmountPerMilestone),
		slog.Int64("total_value_cents", created.AmountPerMilestone*int64(created.TotalMilestones)),
	)
	return created, nil
}

func validateCreate(req model.CreateEscrowRequest) error {
	for _, f := range []struct{ name, value string }{
		{"project_id", req.ProjectID},
		{"client_id", req.ClientID},
		{"contractor_id", req.ContractorID},
	} {
		if f.value == "" {
			return apperr.InvalidInput("%s is required", f.name)
		}
		if _, err := uuid.Parse(f.value); err != nil {
			return apperr.InvalidInput("%s must be a valid UUID", f.name)
		}
	}
	if req.ClientID == req.ContractorID {
		return apperr.InvalidInput("client_id and contractor_id must differ")
	}
	if req.TotalMilestones <= 0 {
		return apperr.InvalidInput("total_milestones must be > 0")
	}
	if req.AmountPerMilestone <= 0 {
		return apperr.InvalidInput("amount_per_milestone must be > 0 (cents)")
	}
	return nil
}

// GetEscrow returns the escrow with the given ID.
func (s *Service) GetEscrow(ctx context.Context, id string) (*model.Escrow, error) {
	if _, err := uuid.Parse(id); err != nil {
		return nil, apperr.InvalidInput("escrow id must be a valid UUID")
	}
	e, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if e == nil {
		return nil, apperr.NotFound("escrow %s not found", id)
	}
	return e, nil
}

// GetEscrowByProject returns the live escrow for a project, so the Next.js
// layer can resolve project → escrow in one hop.
func (s *Service) GetEscrowByProject(ctx context.Context, projectID string) (*model.Escrow, error) {
	if _, err := uuid.Parse(projectID); err != nil {
		return nil, apperr.InvalidInput("project id must be a valid UUID")
	}
	e, err := s.repo.GetByProjectID(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if e == nil {
		return nil, apperr.NotFound("no escrow for project %s", projectID)
	}
	return e, nil
}

// ApproveMilestone approves the next milestone on behalf of the client.
// Guard and increment happen in one SQL statement (supabase/escrow-rpc.sql);
// this only translates the outcome.
func (s *Service) ApproveMilestone(ctx context.Context, id, callerID string) (*model.Escrow, error) {
	if err := validateIDs(id, callerID); err != nil {
		return nil, err
	}

	res, err := s.repo.ApproveMilestone(ctx, id, callerID)
	if err != nil {
		return nil, err
	}
	if res.Code != model.CodeOK {
		return nil, approveError(id, res)
	}

	s.logger.InfoContext(ctx, "milestone approved",
		slog.String("escrow_id", id),
		slog.String("caller_id", callerID),
		slog.Int("milestones_approved", res.Escrow.MilestonesApproved),
		slog.Int("total_milestones", res.Escrow.TotalMilestones),
	)
	return res.Escrow, nil
}

func approveError(id string, res *model.MutationResult) error {
	switch res.Code {
	case model.CodeNotFound:
		return apperr.NotFound("escrow %s not found", id)
	case model.CodeForbidden:
		return apperr.Forbidden("only the client on this escrow may approve milestones")
	case model.CodeEscrowNotActive:
		return apperr.Conflict(apperr.CodeEscrowNotActive,
			"escrow is %s and no longer accepts approvals", res.Escrow.Status)
	case model.CodeAllMilestonesApproved:
		return apperr.Conflict(apperr.CodeNoMilestonesLeft,
			"all %d milestones are already approved", res.Escrow.TotalMilestones)
	default:
		return apperr.Upstream(nil, "unexpected approve result code %q", res.Code)
	}
}

// ClaimMilestone claims the next approved milestone and pays it out.
//
// Ledger increment + outbox row commit together, then the transfer is
// attempted. A crash leaves a durable unsettled row for the retry worker, and
// UNIQUE(escrow_id, milestone_index) makes a double payment impossible.
func (s *Service) ClaimMilestone(ctx context.Context, id, callerID string) (*model.ClaimResult, error) {
	if err := validateIDs(id, callerID); err != nil {
		return nil, err
	}

	res, err := s.repo.ClaimMilestone(ctx, id, callerID)
	if err != nil {
		return nil, err
	}
	if res.Code != model.CodeOK {
		return nil, claimError(id, res)
	}

	s.logger.InfoContext(ctx, "milestone claimed",
		slog.String("escrow_id", id),
		slog.String("caller_id", callerID),
		slog.String("transfer_id", res.TransferID),
		slog.Int("milestone_index", res.MilestoneIndex),
		slog.Int("milestones_claimed", res.Escrow.MilestonesClaimed),
	)

	status := s.settleTransfer(ctx, res)

	return &model.ClaimResult{
		Escrow: res.Escrow,
		Transfer: model.TransferInfo{
			ID:             res.TransferID,
			MilestoneIndex: res.MilestoneIndex,
			AmountCents:    res.Escrow.AmountPerMilestone,
			Status:         status,
		},
	}, nil
}

// settleTransfer attempts the payment and records the outcome. Never returns
// an error: the claim is already committed, so a payment problem downgrades
// the reported status instead of failing an accepted request.
func (s *Service) settleTransfer(ctx context.Context, res *model.MutationResult) model.TransferStatus {
	// Detached from the request context: a client disconnect must not abandon
	// a payment we already owe.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.transferTimeout)
	defer cancel()

	req := transfer.Request{
		ID:             res.TransferID,
		EscrowID:       res.Escrow.ID,
		ContractorID:   res.Escrow.ContractorID,
		MilestoneIndex: res.MilestoneIndex,
		AmountCents:    res.Escrow.AmountPerMilestone,
	}

	if err := s.transfer.Transfer(ctx, req); err != nil {
		// The milestone IS claimed; the retry worker owns the row from here.
		s.logger.ErrorContext(ctx, "fund transfer failed; outbox row left for retry",
			slog.String("transfer_id", res.TransferID),
			slog.String("escrow_id", res.Escrow.ID),
			slog.Int64("amount_cents", res.Escrow.AmountPerMilestone),
			slog.String("error", err.Error()),
		)
		if markErr := s.repo.SettleTransfer(ctx, res.TransferID, model.TransferFailed, err.Error()); markErr != nil {
			s.logger.ErrorContext(ctx, "could not record transfer failure",
				slog.String("transfer_id", res.TransferID),
				slog.String("error", markErr.Error()))
		}
		return model.TransferPending
	}

	if err := s.repo.SettleTransfer(ctx, res.TransferID, model.TransferSent, ""); err != nil {
		// Money moved but we could not record it — the only path to a possible
		// duplicate on retry. Logged with everything needed to reconcile.
		s.logger.ErrorContext(ctx, "TRANSFER SENT BUT NOT RECORDED — needs reconciliation",
			slog.String("transfer_id", res.TransferID),
			slog.String("escrow_id", res.Escrow.ID),
			slog.String("contractor_id", res.Escrow.ContractorID),
			slog.Int("milestone_index", res.MilestoneIndex),
			slog.Int64("amount_cents", res.Escrow.AmountPerMilestone),
			slog.String("error", err.Error()),
		)
		return model.TransferPending
	}
	return model.TransferSent
}

func claimError(id string, res *model.MutationResult) error {
	switch res.Code {
	case model.CodeNotFound:
		return apperr.NotFound("escrow %s not found", id)
	case model.CodeForbidden:
		return apperr.Forbidden("only the contractor on this escrow may claim milestones")
	case model.CodeEscrowNotActive:
		return apperr.Conflict(apperr.CodeEscrowNotActive,
			"escrow is %s and no longer accepts claims", res.Escrow.Status)
	case model.CodeNoApprovedMilestone:
		return apperr.Conflict(apperr.CodeNothingToClaim,
			"no approved milestone available to claim (%d approved, %d claimed)",
			res.Escrow.MilestonesApproved, res.Escrow.MilestonesClaimed)
	default:
		return apperr.Upstream(nil, "unexpected claim result code %q", res.Code)
	}
}

func validateIDs(id, callerID string) error {
	if _, err := uuid.Parse(id); err != nil {
		return apperr.InvalidInput("escrow id must be a valid UUID")
	}
	if _, err := uuid.Parse(callerID); err != nil {
		return apperr.InvalidInput("caller_id must be a valid UUID")
	}
	return nil
}
