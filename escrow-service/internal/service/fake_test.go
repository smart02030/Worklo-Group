package service

import (
	"context"
	"errors"
	"sync"

	"github.com/google/uuid"
	"github.com/worklo/escrow-service/internal/model"
	"github.com/worklo/escrow-service/internal/transfer"
)

// fakeRepo is an in-memory stand-in for the Supabase repository.
//
// It reproduces the property that matters: the milestone mutations are atomic.
// The real implementation gets that from a single guarded SQL statement under a
// Postgres row lock; here a mutex gives the same guarantee, so the concurrency
// tests exercise the service's handling of a repository that behaves correctly
// rather than accidentally testing the mutex.
type fakeRepo struct {
	mu        sync.Mutex
	escrows   map[string]*model.Escrow
	transfers map[string]*fakeTransfer

	// Injectable failures, for exercising paths a real database will not
	// produce on demand.
	createErr   error
	getErr      error
	approveErr  error
	claimErr    error
	settleErr   error
	settleCalls int
}

type fakeTransfer struct {
	escrowID       string
	milestoneIndex int
	status         model.TransferStatus
	lastError      string
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		escrows:   map[string]*model.Escrow{},
		transfers: map[string]*fakeTransfer{},
	}
}

func (f *fakeRepo) seed(e model.Escrow) *model.Escrow {
	f.mu.Lock()
	defer f.mu.Unlock()
	stored := e
	f.escrows[e.ID] = &stored
	return &stored
}

func (f *fakeRepo) snapshot(id string) model.Escrow {
	f.mu.Lock()
	defer f.mu.Unlock()
	return *f.escrows[id]
}

func (f *fakeRepo) Create(ctx context.Context, e *model.Escrow) (*model.Escrow, error) {
	if f.createErr != nil {
		return nil, f.createErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	stored := *e
	f.escrows[e.ID] = &stored
	out := stored
	return &out, nil
}

func (f *fakeRepo) GetByID(ctx context.Context, id string) (*model.Escrow, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	e, ok := f.escrows[id]
	if !ok {
		return nil, nil
	}
	out := *e
	return &out, nil
}

func (f *fakeRepo) GetByProjectID(ctx context.Context, projectID string) (*model.Escrow, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, e := range f.escrows {
		if e.ProjectID == projectID && e.Status != model.StatusCancelled {
			out := *e
			return &out, nil
		}
	}
	return nil, nil
}

// ApproveMilestone mirrors escrow_approve_milestone: guard and increment under
// one lock, with the same result codes.
func (f *fakeRepo) ApproveMilestone(ctx context.Context, id, callerID string) (*model.MutationResult, error) {
	if f.approveErr != nil {
		return nil, f.approveErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	e, ok := f.escrows[id]
	if !ok {
		return &model.MutationResult{Code: model.CodeNotFound}, nil
	}
	if e.ClientID != callerID {
		return &model.MutationResult{Code: model.CodeForbidden, Escrow: copyOf(e)}, nil
	}
	if e.Status != model.StatusActive {
		return &model.MutationResult{Code: model.CodeEscrowNotActive, Escrow: copyOf(e)}, nil
	}
	if e.MilestonesApproved >= e.TotalMilestones {
		return &model.MutationResult{Code: model.CodeAllMilestonesApproved, Escrow: copyOf(e)}, nil
	}

	e.MilestonesApproved++
	return &model.MutationResult{Code: model.CodeOK, Escrow: copyOf(e)}, nil
}

// ClaimMilestone mirrors escrow_claim_milestone, including writing the outbox
// row in the same critical section as the increment.
func (f *fakeRepo) ClaimMilestone(ctx context.Context, id, callerID string) (*model.MutationResult, error) {
	if f.claimErr != nil {
		return nil, f.claimErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	e, ok := f.escrows[id]
	if !ok {
		return &model.MutationResult{Code: model.CodeNotFound}, nil
	}
	if e.ContractorID != callerID {
		return &model.MutationResult{Code: model.CodeForbidden, Escrow: copyOf(e)}, nil
	}
	if e.Status != model.StatusActive {
		return &model.MutationResult{Code: model.CodeEscrowNotActive, Escrow: copyOf(e)}, nil
	}
	if e.MilestonesClaimed >= e.MilestonesApproved {
		return &model.MutationResult{Code: model.CodeNoApprovedMilestone, Escrow: copyOf(e)}, nil
	}

	e.MilestonesClaimed++
	if e.MilestonesClaimed == e.TotalMilestones {
		e.Status = model.StatusCompleted
	}

	transferID := uuid.NewString()
	f.transfers[transferID] = &fakeTransfer{
		escrowID:       e.ID,
		milestoneIndex: e.MilestonesClaimed,
		status:         model.TransferPending,
	}

	return &model.MutationResult{
		Code:           model.CodeOK,
		Escrow:         copyOf(e),
		TransferID:     transferID,
		MilestoneIndex: e.MilestonesClaimed,
	}, nil
}

func (f *fakeRepo) SettleTransfer(ctx context.Context, transferID string, status model.TransferStatus, lastErr string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.settleCalls++
	if f.settleErr != nil {
		return f.settleErr
	}
	t, ok := f.transfers[transferID]
	if !ok {
		return errors.New("transfer not found")
	}
	t.status = status
	t.lastError = lastErr
	return nil
}

func (f *fakeRepo) transferByIndex(escrowID string, idx int) *fakeTransfer {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, t := range f.transfers {
		if t.escrowID == escrowID && t.milestoneIndex == idx {
			return t
		}
	}
	return nil
}

func (f *fakeRepo) transferCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.transfers)
}

func copyOf(e *model.Escrow) *model.Escrow {
	out := *e
	return &out
}

// ---------------------------------------------------------------------------
// Fake transferrer
// ---------------------------------------------------------------------------

// fakeTransferrer records every payment attempt and can be made to fail, which
// is the whole point: the failure path is where the interesting guarantees live
// and it is not reachable through a real payment provider on demand.
type fakeTransferrer struct {
	mu    sync.Mutex
	calls []transfer.Request
	err   error
}

func (f *fakeTransferrer) Transfer(ctx context.Context, req transfer.Request) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, req)
	return f.err
}

func (f *fakeTransferrer) attempts() []transfer.Request {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]transfer.Request, len(f.calls))
	copy(out, f.calls)
	return out
}
