package service

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/worklo/escrow-service/internal/apperr"
	"github.com/worklo/escrow-service/internal/model"
)

// Fixed IDs so failures name the actor rather than a random UUID.
var (
	escrowID     = uuid.NewString()
	projectID    = uuid.NewString()
	clientID     = uuid.NewString()
	contractorID = uuid.NewString()
	strangerID   = uuid.NewString()
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newSUT(t *testing.T) (*Service, *fakeRepo, *fakeTransferrer) {
	t.Helper()
	repo := newFakeRepo()
	tr := &fakeTransferrer{}
	return New(repo, tr, discardLogger(), 2*time.Second), repo, tr
}

func activeEscrow(total, approved, claimed int) model.Escrow {
	return model.Escrow{
		ID:                 escrowID,
		ProjectID:          projectID,
		ClientID:           clientID,
		ContractorID:       contractorID,
		TotalMilestones:    total,
		MilestonesApproved: approved,
		MilestonesClaimed:  claimed,
		AmountPerMilestone: 50_000,
		Status:             model.StatusActive,
		CreatedAt:          time.Now().UTC(),
	}
}

// assertAppErr checks the classified code and HTTP status of a failure.
func assertAppErr(t *testing.T, err error, wantCode apperr.Code, wantStatus int) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error with code %s, got nil", wantCode)
	}
	var appErr *apperr.Error
	if !errors.As(err, &appErr) {
		t.Fatalf("expected *apperr.Error, got %T: %v", err, err)
	}
	if appErr.Code != wantCode {
		t.Errorf("code = %s, want %s (message: %s)", appErr.Code, wantCode, appErr.Message)
	}
	if appErr.Status != wantStatus {
		t.Errorf("status = %d, want %d", appErr.Status, wantStatus)
	}
	if appErr.Message == "" {
		t.Error("error message is empty; callers get no explanation")
	}
}

// ---------------------------------------------------------------------------
// CreateEscrow
// ---------------------------------------------------------------------------

func TestCreateEscrow_Valid(t *testing.T) {
	svc, repo, _ := newSUT(t)

	got, err := svc.CreateEscrow(context.Background(), model.CreateEscrowRequest{
		ProjectID:          projectID,
		ClientID:           clientID,
		ContractorID:       contractorID,
		TotalMilestones:    4,
		AmountPerMilestone: 25_000,
	})
	if err != nil {
		t.Fatalf("CreateEscrow: %v", err)
	}

	if got.Status != model.StatusActive {
		t.Errorf("status = %s, want active", got.Status)
	}
	if got.MilestonesApproved != 0 || got.MilestonesClaimed != 0 {
		t.Errorf("new escrow should start at 0/0, got %d/%d",
			got.MilestonesApproved, got.MilestonesClaimed)
	}
	if _, err := uuid.Parse(got.ID); err != nil {
		t.Errorf("generated id %q is not a UUID", got.ID)
	}
	if _, ok := repo.escrows[got.ID]; !ok {
		t.Error("escrow was not persisted")
	}
}

func TestCreateEscrow_Validation(t *testing.T) {
	valid := model.CreateEscrowRequest{
		ProjectID:          projectID,
		ClientID:           clientID,
		ContractorID:       contractorID,
		TotalMilestones:    3,
		AmountPerMilestone: 1_000,
	}

	tests := []struct {
		name   string
		mutate func(*model.CreateEscrowRequest)
	}{
		{"missing project_id", func(r *model.CreateEscrowRequest) { r.ProjectID = "" }},
		{"missing client_id", func(r *model.CreateEscrowRequest) { r.ClientID = "" }},
		{"missing contractor_id", func(r *model.CreateEscrowRequest) { r.ContractorID = "" }},
		{"non-uuid project_id", func(r *model.CreateEscrowRequest) { r.ProjectID = "not-a-uuid" }},
		{"zero milestones", func(r *model.CreateEscrowRequest) { r.TotalMilestones = 0 }},
		{"negative milestones", func(r *model.CreateEscrowRequest) { r.TotalMilestones = -2 }},
		{"zero amount", func(r *model.CreateEscrowRequest) { r.AmountPerMilestone = 0 }},
		{"negative amount", func(r *model.CreateEscrowRequest) { r.AmountPerMilestone = -1 }},
		// A self-dealing escrow would let one party both approve and claim,
		// defeating the point of escrow entirely.
		{"client is contractor", func(r *model.CreateEscrowRequest) { r.ContractorID = r.ClientID }},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc, repo, _ := newSUT(t)
			req := valid
			tc.mutate(&req)

			_, err := svc.CreateEscrow(context.Background(), req)
			assertAppErr(t, err, apperr.CodeInvalidInput, 400)

			if len(repo.escrows) != 0 {
				t.Error("invalid request must not persist anything")
			}
		})
	}
}

func TestCreateEscrow_RepositoryFailureIsNotSwallowed(t *testing.T) {
	svc, repo, _ := newSUT(t)
	repo.createErr = apperr.Upstream(errors.New("connection refused"), "supabase unreachable")

	_, err := svc.CreateEscrow(context.Background(), model.CreateEscrowRequest{
		ProjectID: projectID, ClientID: clientID, ContractorID: contractorID,
		TotalMilestones: 1, AmountPerMilestone: 100,
	})
	assertAppErr(t, err, apperr.CodeUpstreamFailure, 502)
}

// ---------------------------------------------------------------------------
// GetEscrow
// ---------------------------------------------------------------------------

func TestGetEscrow(t *testing.T) {
	t.Run("found", func(t *testing.T) {
		svc, repo, _ := newSUT(t)
		repo.seed(activeEscrow(3, 1, 1))

		got, err := svc.GetEscrow(context.Background(), escrowID)
		if err != nil {
			t.Fatalf("GetEscrow: %v", err)
		}
		if got.ID != escrowID {
			t.Errorf("id = %s, want %s", got.ID, escrowID)
		}
	})

	t.Run("missing row is 404", func(t *testing.T) {
		svc, _, _ := newSUT(t)
		_, err := svc.GetEscrow(context.Background(), uuid.NewString())
		assertAppErr(t, err, apperr.CodeNotFound, 404)
	})

	t.Run("malformed id is 400 not 404", func(t *testing.T) {
		svc, _, _ := newSUT(t)
		_, err := svc.GetEscrow(context.Background(), "nonsense")
		assertAppErr(t, err, apperr.CodeInvalidInput, 400)
	})

	// A failing database must never masquerade as "no such escrow" — that is
	// how an outage gets misdiagnosed as missing data.
	t.Run("upstream failure is 502 not 404", func(t *testing.T) {
		svc, repo, _ := newSUT(t)
		repo.getErr = apperr.Upstream(errors.New("i/o timeout"), "supabase read failed")

		_, err := svc.GetEscrow(context.Background(), escrowID)
		assertAppErr(t, err, apperr.CodeUpstreamFailure, 502)
	})
}

func TestGetEscrowByProject(t *testing.T) {
	svc, repo, _ := newSUT(t)
	repo.seed(activeEscrow(2, 0, 0))

	got, err := svc.GetEscrowByProject(context.Background(), projectID)
	if err != nil {
		t.Fatalf("GetEscrowByProject: %v", err)
	}
	if got.ID != escrowID {
		t.Errorf("id = %s, want %s", got.ID, escrowID)
	}

	if _, err := svc.GetEscrowByProject(context.Background(), uuid.NewString()); err == nil {
		t.Error("expected 404 for a project with no escrow")
	}
}

// ---------------------------------------------------------------------------
// ApproveMilestone
// ---------------------------------------------------------------------------

func TestApproveMilestone_Authorisation(t *testing.T) {
	tests := []struct {
		name     string
		caller   string
		wantCode apperr.Code
		wantHTTP int
	}{
		{"client may approve", clientID, "", 0},
		{"contractor may not approve", contractorID, apperr.CodeForbidden, 403},
		{"stranger may not approve", strangerID, apperr.CodeForbidden, 403},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc, repo, _ := newSUT(t)
			repo.seed(activeEscrow(3, 0, 0))

			got, err := svc.ApproveMilestone(context.Background(), escrowID, tc.caller)

			if tc.wantCode == "" {
				if err != nil {
					t.Fatalf("ApproveMilestone: %v", err)
				}
				if got.MilestonesApproved != 1 {
					t.Errorf("milestones_approved = %d, want 1", got.MilestonesApproved)
				}
				return
			}

			assertAppErr(t, err, tc.wantCode, tc.wantHTTP)
			if repo.snapshot(escrowID).MilestonesApproved != 0 {
				t.Error("rejected approval must not change the count")
			}
		})
	}
}

func TestApproveMilestone_StateGuards(t *testing.T) {
	t.Run("exhausted", func(t *testing.T) {
		svc, repo, _ := newSUT(t)
		repo.seed(activeEscrow(2, 2, 0))

		_, err := svc.ApproveMilestone(context.Background(), escrowID, clientID)
		assertAppErr(t, err, apperr.CodeNoMilestonesLeft, 409)
	})

	t.Run("cancelled escrow", func(t *testing.T) {
		svc, repo, _ := newSUT(t)
		e := activeEscrow(3, 1, 0)
		e.Status = model.StatusCancelled
		repo.seed(e)

		_, err := svc.ApproveMilestone(context.Background(), escrowID, clientID)
		assertAppErr(t, err, apperr.CodeEscrowNotActive, 409)
	})

	t.Run("unknown escrow", func(t *testing.T) {
		svc, _, _ := newSUT(t)
		_, err := svc.ApproveMilestone(context.Background(), uuid.NewString(), clientID)
		assertAppErr(t, err, apperr.CodeNotFound, 404)
	})

	t.Run("malformed caller id", func(t *testing.T) {
		svc, repo, _ := newSUT(t)
		repo.seed(activeEscrow(3, 0, 0))

		_, err := svc.ApproveMilestone(context.Background(), escrowID, "not-a-uuid")
		assertAppErr(t, err, apperr.CodeInvalidInput, 400)
	})
}

// TestApproveMilestone_Concurrent is the core concurrency assertion: N
// simultaneous approvals against an escrow with M < N milestones must produce
// exactly M successes and leave the count at exactly M. A read-modify-write
// implementation fails this — increments interleave and are lost.
func TestApproveMilestone_Concurrent(t *testing.T) {
	const (
		total   = 5
		callers = 50
	)
	svc, repo, _ := newSUT(t)
	repo.seed(activeEscrow(total, 0, 0))

	var (
		wg        sync.WaitGroup
		mu        sync.Mutex
		succeeded int
		rejected  int
	)

	start := make(chan struct{})
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start // release everyone at once to maximise contention
			_, err := svc.ApproveMilestone(context.Background(), escrowID, clientID)

			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				succeeded++
			} else {
				rejected++
				assertConflict(t, err)
			}
		}()
	}
	close(start)
	wg.Wait()

	if succeeded != total {
		t.Errorf("successful approvals = %d, want exactly %d", succeeded, total)
	}
	if rejected != callers-total {
		t.Errorf("rejections = %d, want %d", rejected, callers-total)
	}
	if final := repo.snapshot(escrowID); final.MilestonesApproved != total {
		t.Errorf("final milestones_approved = %d, want %d — increments were lost or double-counted",
			final.MilestonesApproved, total)
	}
}

func assertConflict(t *testing.T, err error) {
	t.Helper()
	var appErr *apperr.Error
	if errors.As(err, &appErr) && appErr.Status == 409 {
		return
	}
	t.Errorf("losing approval should be a 409 conflict, got %v", err)
}

// ---------------------------------------------------------------------------
// ClaimMilestone
// ---------------------------------------------------------------------------

func TestClaimMilestone_Success(t *testing.T) {
	svc, repo, tr := newSUT(t)
	repo.seed(activeEscrow(3, 2, 0))

	got, err := svc.ClaimMilestone(context.Background(), escrowID, contractorID)
	if err != nil {
		t.Fatalf("ClaimMilestone: %v", err)
	}

	if got.MilestonesClaimed != 1 {
		t.Errorf("milestones_claimed = %d, want 1", got.MilestonesClaimed)
	}
	if got.Transfer.Status != model.TransferSent {
		t.Errorf("transfer status = %s, want sent", got.Transfer.Status)
	}
	if got.Transfer.AmountCents != 50_000 {
		t.Errorf("transfer amount = %d, want 50000", got.Transfer.AmountCents)
	}
	if got.Transfer.MilestoneIndex != 1 {
		t.Errorf("milestone_index = %d, want 1", got.Transfer.MilestoneIndex)
	}

	attempts := tr.attempts()
	if len(attempts) != 1 {
		t.Fatalf("transfer attempts = %d, want 1", len(attempts))
	}
	if attempts[0].ContractorID != contractorID {
		t.Errorf("paid %s, want contractor %s", attempts[0].ContractorID, contractorID)
	}
	if settled := repo.transferByIndex(escrowID, 1); settled.status != model.TransferSent {
		t.Errorf("outbox row status = %s, want sent", settled.status)
	}
}

func TestClaimMilestone_Authorisation(t *testing.T) {
	for _, caller := range []struct {
		name string
		id   string
	}{
		{"client may not claim", clientID},
		{"stranger may not claim", strangerID},
	} {
		t.Run(caller.name, func(t *testing.T) {
			svc, repo, tr := newSUT(t)
			repo.seed(activeEscrow(3, 2, 0))

			_, err := svc.ClaimMilestone(context.Background(), escrowID, caller.id)
			assertAppErr(t, err, apperr.CodeForbidden, 403)

			if len(tr.attempts()) != 0 {
				t.Error("an unauthorised claim must never move money")
			}
			if repo.transferCount() != 0 {
				t.Error("an unauthorised claim must not create an outbox row")
			}
		})
	}
}

func TestClaimMilestone_StateGuards(t *testing.T) {
	t.Run("nothing approved yet", func(t *testing.T) {
		svc, repo, tr := newSUT(t)
		repo.seed(activeEscrow(3, 0, 0))

		_, err := svc.ClaimMilestone(context.Background(), escrowID, contractorID)
		assertAppErr(t, err, apperr.CodeNothingToClaim, 409)

		if len(tr.attempts()) != 0 {
			t.Error("claiming an unapproved milestone must not pay out")
		}
	})

	t.Run("already caught up with approvals", func(t *testing.T) {
		svc, repo, _ := newSUT(t)
		repo.seed(activeEscrow(3, 1, 1))

		_, err := svc.ClaimMilestone(context.Background(), escrowID, contractorID)
		assertAppErr(t, err, apperr.CodeNothingToClaim, 409)
	})

	t.Run("unknown escrow", func(t *testing.T) {
		svc, _, _ := newSUT(t)
		_, err := svc.ClaimMilestone(context.Background(), uuid.NewString(), contractorID)
		assertAppErr(t, err, apperr.CodeNotFound, 404)
	})
}

// The escrow completes when the money is out, not when the work is approved.
func TestClaimMilestone_CompletesOnFinalClaim(t *testing.T) {
	svc, repo, _ := newSUT(t)
	repo.seed(activeEscrow(2, 2, 1))

	got, err := svc.ClaimMilestone(context.Background(), escrowID, contractorID)
	if err != nil {
		t.Fatalf("ClaimMilestone: %v", err)
	}
	if got.Status != model.StatusCompleted {
		t.Errorf("status = %s, want completed after the final claim", got.Status)
	}

	// A completed escrow accepts nothing further.
	_, err = svc.ClaimMilestone(context.Background(), escrowID, contractorID)
	assertAppErr(t, err, apperr.CodeEscrowNotActive, 409)

	_, err = svc.ApproveMilestone(context.Background(), escrowID, clientID)
	assertAppErr(t, err, apperr.CodeEscrowNotActive, 409)
}

// A failed transfer must NOT fail the claim: the ledger increment is already
// committed, and reporting an error would invite a retry that the constraint
// would reject anyway. The obligation stays durable and unsettled.
func TestClaimMilestone_TransferFailureLeavesClaimCommitted(t *testing.T) {
	svc, repo, tr := newSUT(t)
	repo.seed(activeEscrow(3, 1, 0))
	tr.err = errors.New("payment provider timeout")

	got, err := svc.ClaimMilestone(context.Background(), escrowID, contractorID)
	if err != nil {
		t.Fatalf("a transfer failure must not fail the claim, got: %v", err)
	}

	if got.MilestonesClaimed != 1 {
		t.Errorf("milestones_claimed = %d, want 1 — the claim is committed", got.MilestonesClaimed)
	}
	// Reported as pending, not sent: the caller is told the truth.
	if got.Transfer.Status != model.TransferPending {
		t.Errorf("transfer status = %s, want pending", got.Transfer.Status)
	}

	row := repo.transferByIndex(escrowID, 1)
	if row == nil {
		t.Fatal("outbox row missing; the payment obligation was lost")
	}
	if row.status != model.TransferFailed {
		t.Errorf("outbox status = %s, want failed so the retry worker picks it up", row.status)
	}
	if row.lastError == "" {
		t.Error("outbox row records no error; the failure is not diagnosable")
	}
}

// The dangerous case: the money moved but recording it failed. The claim still
// succeeds, and the transfer is reported as pending rather than sent — an
// operator reconciles from the ERROR log.
func TestClaimMilestone_SettlementWriteFailureStillSucceeds(t *testing.T) {
	svc, repo, tr := newSUT(t)
	repo.seed(activeEscrow(3, 1, 0))
	repo.settleErr = errors.New("supabase write failed")

	got, err := svc.ClaimMilestone(context.Background(), escrowID, contractorID)
	if err != nil {
		t.Fatalf("ClaimMilestone: %v", err)
	}

	if len(tr.attempts()) != 1 {
		t.Fatalf("transfer attempts = %d, want 1", len(tr.attempts()))
	}
	if got.Transfer.Status != model.TransferPending {
		t.Errorf("transfer status = %s, want pending when settlement could not be recorded",
			got.Transfer.Status)
	}
	if got.MilestonesClaimed != 1 {
		t.Errorf("milestones_claimed = %d, want 1", got.MilestonesClaimed)
	}
}

// A client that hangs up mid-request is still owed its payment. The transfer
// runs on a context detached from the request's.
func TestClaimMilestone_CancelledRequestStillPays(t *testing.T) {
	svc, repo, tr := newSUT(t)
	repo.seed(activeEscrow(3, 1, 0))

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // caller disconnected before we got here

	got, err := svc.ClaimMilestone(ctx, escrowID, contractorID)
	if err != nil {
		t.Fatalf("ClaimMilestone: %v", err)
	}
	if len(tr.attempts()) != 1 {
		t.Errorf("transfer attempts = %d, want 1 — a disconnect must not abandon the payment",
			len(tr.attempts()))
	}
	if got.Transfer.Status != model.TransferSent {
		t.Errorf("transfer status = %s, want sent", got.Transfer.Status)
	}
}

// Concurrent claims cannot over-pay: exactly one payment per approved
// milestone, each with a distinct index.
func TestClaimMilestone_Concurrent(t *testing.T) {
	const (
		total    = 10
		approved = 4
		callers  = 40
	)
	svc, repo, tr := newSUT(t)
	repo.seed(activeEscrow(total, approved, 0))

	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, _ = svc.ClaimMilestone(context.Background(), escrowID, contractorID)
		}()
	}
	close(start)
	wg.Wait()

	if final := repo.snapshot(escrowID); final.MilestonesClaimed != approved {
		t.Errorf("milestones_claimed = %d, want %d", final.MilestonesClaimed, approved)
	}
	if paid := len(tr.attempts()); paid != approved {
		t.Errorf("payments made = %d, want %d — the contractor was over- or under-paid", paid, approved)
	}
	if rows := repo.transferCount(); rows != approved {
		t.Errorf("outbox rows = %d, want %d", rows, approved)
	}

	// Every payment settles a distinct milestone; a duplicate index would mean
	// the same milestone was paid twice.
	seen := map[int]bool{}
	for _, a := range tr.attempts() {
		if seen[a.MilestoneIndex] {
			t.Errorf("milestone %d was paid more than once", a.MilestoneIndex)
		}
		seen[a.MilestoneIndex] = true
	}
}

// Approvals and claims racing against each other must never let claims outrun
// approvals — that would pay for work nobody signed off.
func TestApproveAndClaim_InterleavedNeverOverclaims(t *testing.T) {
	const total = 8
	svc, repo, tr := newSUT(t)
	repo.seed(activeEscrow(total, 0, 0))

	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < total; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, _ = svc.ApproveMilestone(context.Background(), escrowID, clientID)
		}()
	}
	for i := 0; i < total*3; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, _ = svc.ClaimMilestone(context.Background(), escrowID, contractorID)
		}()
	}
	close(start)
	wg.Wait()

	final := repo.snapshot(escrowID)
	if final.MilestonesApproved != total {
		t.Errorf("milestones_approved = %d, want %d", final.MilestonesApproved, total)
	}
	if final.MilestonesClaimed > final.MilestonesApproved {
		t.Errorf("claimed %d > approved %d — paid for unapproved work",
			final.MilestonesClaimed, final.MilestonesApproved)
	}
	if paid := len(tr.attempts()); paid != final.MilestonesClaimed {
		t.Errorf("payments = %d but claims = %d; ledger and money disagree",
			paid, final.MilestonesClaimed)
	}
}
