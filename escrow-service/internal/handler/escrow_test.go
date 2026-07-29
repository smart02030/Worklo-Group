package handler

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/mux"
	"github.com/worklo/escrow-service/internal/apperr"
	"github.com/worklo/escrow-service/internal/middleware"
	"github.com/worklo/escrow-service/internal/model"
)

// stubService lets the HTTP layer be tested on its own: status mapping, error
// envelopes and body validation, with no service or database underneath.
type stubService struct {
	escrow      *model.Escrow
	claimResult *model.ClaimResult
	err         error

	gotCreate   model.CreateEscrowRequest
	gotID       string
	gotCallerID string
}

func (s *stubService) CreateEscrow(ctx context.Context, req model.CreateEscrowRequest) (*model.Escrow, error) {
	s.gotCreate = req
	return s.escrow, s.err
}

func (s *stubService) GetEscrow(ctx context.Context, id string) (*model.Escrow, error) {
	s.gotID = id
	return s.escrow, s.err
}

func (s *stubService) GetEscrowByProject(ctx context.Context, projectID string) (*model.Escrow, error) {
	s.gotID = projectID
	return s.escrow, s.err
}

func (s *stubService) ApproveMilestone(ctx context.Context, id, callerID string) (*model.Escrow, error) {
	s.gotID, s.gotCallerID = id, callerID
	return s.escrow, s.err
}

func (s *stubService) ClaimMilestone(ctx context.Context, id, callerID string) (*model.ClaimResult, error) {
	s.gotID, s.gotCallerID = id, callerID
	return s.claimResult, s.err
}

func newRouter(stub *stubService) http.Handler {
	h := New(stub, slog.New(slog.NewTextHandler(io.Discard, nil)))
	r := mux.NewRouter()
	r.HandleFunc("/escrow", h.CreateEscrow).Methods(http.MethodPost)
	r.HandleFunc("/escrow/{id}", h.GetEscrow).Methods(http.MethodGet)
	r.HandleFunc("/escrow/{id}/approve-milestone", h.ApproveMilestone).Methods(http.MethodPost)
	r.HandleFunc("/escrow/{id}/claim-milestone", h.ClaimMilestone).Methods(http.MethodPost)
	r.Use(middleware.RequestID)
	return r
}

func do(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) errorBody {
	t.Helper()
	var body errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not a JSON error envelope: %v (body: %s)", err, rec.Body.String())
	}
	return body
}

const sampleID = "6b3f1c1e-4b1a-4c0a-9a5f-2f1d5c6a7b8e"

func sampleEscrow() *model.Escrow {
	return &model.Escrow{
		ID: sampleID, TotalMilestones: 3, MilestonesApproved: 1,
		AmountPerMilestone: 1000, Status: model.StatusActive,
	}
}

// Every sentinel error class must land on its intended HTTP status. This is the
// contract the Next.js proxy and the UI branch on.
func TestErrorStatusMapping(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   apperr.Code
	}{
		{"not found", apperr.NotFound("escrow %s not found", sampleID), 404, apperr.CodeNotFound},
		{"forbidden", apperr.Forbidden("wrong caller"), 403, apperr.CodeForbidden},
		{"invalid input", apperr.InvalidInput("bad id"), 400, apperr.CodeInvalidInput},
		{"conflict", apperr.Conflict(apperr.CodeNothingToClaim, "nothing to claim"), 409, apperr.CodeNothingToClaim},
		{"upstream", apperr.Upstream(nil, "supabase down"), 502, apperr.CodeUpstreamFailure},
		// An unclassified error must not leak its text to the caller.
		{"unclassified", io.ErrUnexpectedEOF, 500, apperr.CodeInternal},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := do(t, newRouter(&stubService{err: tc.err}), http.MethodGet, "/escrow/"+sampleID, "")

			if rec.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			body := decodeError(t, rec)
			if body.Error.Code != tc.wantCode {
				t.Errorf("code = %s, want %s", body.Error.Code, tc.wantCode)
			}
			if body.Error.Message == "" {
				t.Error("error message is empty")
			}
			// Every error is traceable back to its logs.
			if body.Error.RequestID == "" {
				t.Error("error envelope carries no request_id")
			}
			if got := rec.Header().Get(middleware.HeaderRequestID); got != body.Error.RequestID {
				t.Errorf("header request id %q != body request id %q", got, body.Error.RequestID)
			}
		})
	}
}

func TestInternalErrorDoesNotLeakCause(t *testing.T) {
	secret := "postgres://user:hunter2@db.internal:5432"
	stub := &stubService{err: apperr.Upstream(io.ErrUnexpectedEOF, "supabase request failed to %s", secret)}

	rec := do(t, newRouter(stub), http.MethodGet, "/escrow/"+sampleID, "")
	if strings.Contains(rec.Body.String(), "unexpected EOF") {
		t.Errorf("internal cause leaked to the client: %s", rec.Body.String())
	}
}

func TestCreateEscrow(t *testing.T) {
	t.Run("created", func(t *testing.T) {
		stub := &stubService{escrow: sampleEscrow()}
		rec := do(t, newRouter(stub), http.MethodPost, "/escrow",
			`{"project_id":"p","client_id":"c","contractor_id":"k","total_milestones":3,"amount_per_milestone":1000}`)

		if rec.Code != http.StatusCreated {
			t.Errorf("status = %d, want 201 (body: %s)", rec.Code, rec.Body.String())
		}
		if stub.gotCreate.TotalMilestones != 3 || stub.gotCreate.AmountPerMilestone != 1000 {
			t.Errorf("body was not decoded into the request: %+v", stub.gotCreate)
		}
	})

	t.Run("malformed JSON", func(t *testing.T) {
		rec := do(t, newRouter(&stubService{}), http.MethodPost, "/escrow", `{"project_id":`)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", rec.Code)
		}
	})

	// A misspelled field silently defaulting to zero is how a 0-milestone
	// escrow gets created by accident.
	t.Run("unknown field is rejected", func(t *testing.T) {
		rec := do(t, newRouter(&stubService{escrow: sampleEscrow()}), http.MethodPost, "/escrow",
			`{"project_id":"p","totalMilestones":3}`)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400 for an unknown field", rec.Code)
		}
	})
}

func TestMilestoneActions(t *testing.T) {
	t.Run("approve passes caller through", func(t *testing.T) {
		stub := &stubService{escrow: sampleEscrow()}
		rec := do(t, newRouter(stub), http.MethodPost,
			"/escrow/"+sampleID+"/approve-milestone", `{"caller_id":"caller-1"}`)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
		}
		if stub.gotID != sampleID || stub.gotCallerID != "caller-1" {
			t.Errorf("service got id=%q caller=%q", stub.gotID, stub.gotCallerID)
		}
	})

	t.Run("missing caller_id", func(t *testing.T) {
		for _, path := range []string{"approve-milestone", "claim-milestone"} {
			rec := do(t, newRouter(&stubService{}), http.MethodPost, "/escrow/"+sampleID+"/"+path, `{}`)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("%s: status = %d, want 400", path, rec.Code)
			}
			if code := decodeError(t, rec).Error.Code; code != apperr.CodeInvalidInput {
				t.Errorf("%s: code = %s, want INVALID_INPUT", path, code)
			}
		}
	})
}

// A claim serialises the escrow fields at the top level (so existing clients
// keep working) alongside an explicit transfer status.
func TestClaimMilestoneResponseShape(t *testing.T) {
	stub := &stubService{claimResult: &model.ClaimResult{
		Escrow: sampleEscrow(),
		Transfer: model.TransferInfo{
			ID: "t-1", MilestoneIndex: 1, AmountCents: 1000, Status: model.TransferPending,
		},
	}}

	rec := do(t, newRouter(stub), http.MethodPost,
		"/escrow/"+sampleID+"/claim-milestone", `{"caller_id":"caller-1"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if body["id"] != sampleID {
		t.Errorf("escrow fields are not top-level: %s", rec.Body.String())
	}

	tr, ok := body["transfer"].(map[string]any)
	if !ok {
		t.Fatalf("response has no transfer object: %s", rec.Body.String())
	}
	// A pending payment must be visible to the caller, not hidden behind a 200.
	if tr["status"] != string(model.TransferPending) {
		t.Errorf("transfer.status = %v, want pending", tr["status"])
	}
}

// An ID assigned upstream survives into this service, so one trace spans the
// Next.js proxy and the Go service.
func TestRequestIDIsPropagatedNotReplaced(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/escrow/"+sampleID, nil)
	req.Header.Set(middleware.HeaderRequestID, "upstream-trace-42")
	rec := httptest.NewRecorder()

	newRouter(&stubService{escrow: sampleEscrow()}).ServeHTTP(rec, req)

	if got := rec.Header().Get(middleware.HeaderRequestID); got != "upstream-trace-42" {
		t.Errorf("request id = %q, want the upstream one preserved", got)
	}
}
