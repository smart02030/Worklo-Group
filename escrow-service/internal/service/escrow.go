package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/worklo/escrow-service/internal/model"
	"github.com/worklo/escrow-service/internal/repository"
)

// Sentinel errors — map to HTTP status codes in the handler layer.
var (
	ErrNotFound      = errors.New("escrow not found")
	ErrForbidden     = errors.New("caller is not authorised for this action")
	ErrInvalidInput  = errors.New("invalid input")
	ErrInvalidState  = errors.New("invalid state transition")
)

// Service contains the business logic for escrow operations.
type Service struct {
	repo *repository.Repository
}

// New creates a Service backed by repo.
func New(repo *repository.Repository) *Service {
	return &Service{repo: repo}
}

// CreateEscrow validates the request and creates a new active escrow.
func (s *Service) CreateEscrow(ctx context.Context, req model.CreateEscrowRequest) (*model.Escrow, error) {
	if req.ProjectID == "" || req.ClientID == "" || req.ContractorID == "" {
		return nil, fmt.Errorf("%w: project_id, client_id, and contractor_id are required", ErrInvalidInput)
	}
	if req.TotalMilestones <= 0 {
		return nil, fmt.Errorf("%w: total_milestones must be > 0", ErrInvalidInput)
	}
	if req.AmountPerMilestone <= 0 {
		return nil, fmt.Errorf("%w: amount_per_milestone must be > 0", ErrInvalidInput)
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

	return s.repo.Create(ctx, escrow)
}

// GetEscrow returns the escrow with the given ID, or ErrNotFound.
func (s *Service) GetEscrow(ctx context.Context, id string) (*model.Escrow, error) {
	e, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if e == nil {
		return nil, ErrNotFound
	}
	return e, nil
}

// ApproveMilestone increments milestones_approved by 1.
//
// This operation must be executed inside a database transaction (here simulated
// via a fetch-then-update with a precondition check) to prevent two concurrent
// approvals both reading the same count and both writing count+1, resulting in
// only one effective increment instead of two. In production, use a Postgres
// UPDATE … WHERE … RETURNING with a row-level lock.
func (s *Service) ApproveMilestone(ctx context.Context, id, callerID string) (*model.Escrow, error) {
	e, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if e == nil {
		return nil, ErrNotFound
	}
	if e.ClientID != callerID {
		return nil, ErrForbidden
	}
	if e.MilestonesApproved >= e.TotalMilestones {
		return nil, fmt.Errorf("%w: all milestones are already approved", ErrInvalidState)
	}

	e.MilestonesApproved++
	if e.MilestonesApproved == e.TotalMilestones {
		e.Status = model.StatusCompleted
	}

	if err := s.repo.Update(ctx, e); err != nil {
		return nil, err
	}
	return e, nil
}

// ClaimMilestone increments milestones_claimed by 1.
//
// The ledger update (milestones_claimed += 1) must be committed BEFORE any
// fund-transfer side effect. If the transfer succeeded but the counter was not
// yet persisted and the process crashed, the contractor could re-submit the
// claim and receive the same milestone payment twice. Writing state first means
// a crash after the write but before the transfer requires a retry/reconciliation
// path rather than risking a double-payment.
func (s *Service) ClaimMilestone(ctx context.Context, id, callerID string) (*model.Escrow, error) {
	e, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if e == nil {
		return nil, ErrNotFound
	}
	if e.ContractorID != callerID {
		return nil, ErrForbidden
	}
	if e.MilestonesClaimed >= e.MilestonesApproved {
		return nil, fmt.Errorf("%w: no approved milestones available to claim", ErrInvalidState)
	}
	if e.MilestonesClaimed >= e.TotalMilestones {
		return nil, fmt.Errorf("%w: all milestones have already been claimed", ErrInvalidState)
	}

	// Update state BEFORE any fund-transfer side effect (see comment above).
	e.MilestonesClaimed++
	if err := s.repo.Update(ctx, e); err != nil {
		return nil, err
	}

	// TODO: trigger actual fund transfer here (e.g., Stripe, bank API, etc.)

	return e, nil
}
