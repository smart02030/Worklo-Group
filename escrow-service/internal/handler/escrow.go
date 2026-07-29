package handler

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/worklo/escrow-service/internal/apperr"
	"github.com/worklo/escrow-service/internal/model"
	"github.com/worklo/escrow-service/internal/observability"
)

// maxBodyBytes caps request bodies; every payload here is a few fields.
const maxBodyBytes = 32 << 10

// EscrowService is what the HTTP layer needs, so handlers can be tested
// against a stub with no service or database behind them.
type EscrowService interface {
	CreateEscrow(ctx context.Context, req model.CreateEscrowRequest) (*model.Escrow, error)
	GetEscrow(ctx context.Context, id string) (*model.Escrow, error)
	GetEscrowByProject(ctx context.Context, projectID string) (*model.Escrow, error)
	ApproveMilestone(ctx context.Context, id, callerID string) (*model.Escrow, error)
	ClaimMilestone(ctx context.Context, id, callerID string) (*model.ClaimResult, error)
}

// Handler holds HTTP handler methods for the escrow service.
type Handler struct {
	svc    EscrowService
	logger *slog.Logger
}

// New creates a Handler backed by svc.
func New(svc EscrowService, logger *slog.Logger) *Handler {
	return &Handler{svc: svc, logger: logger}
}

// errorBody is the single envelope every failure uses. request_id lets a
// caller quote it and an operator find the matching logs.
type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code      apperr.Code `json:"code"`
	Message   string      `json:"message"`
	RequestID string      `json:"request_id,omitempty"`
}

// writeError classifies err, logs the cause, and returns the public envelope.
// The cause never crosses the wire.
func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	appErr := apperr.From(err)

	if appErr.Status >= 500 {
		h.logger.ErrorContext(r.Context(), "request failed",
			slog.String("code", string(appErr.Code)),
			slog.String("message", appErr.Message),
			slog.String("cause", causeOf(appErr)),
			slog.String("path", r.URL.Path),
		)
	} else {
		h.logger.WarnContext(r.Context(), "request rejected",
			slog.String("code", string(appErr.Code)),
			slog.String("message", appErr.Message),
			slog.String("path", r.URL.Path),
		)
	}

	writeJSON(w, appErr.Status, errorBody{Error: errorDetail{
		Code:      appErr.Code,
		Message:   appErr.Message,
		RequestID: observability.RequestIDFrom(r.Context()),
	}})
}

func causeOf(e *apperr.Error) string {
	if e.Err == nil {
		return ""
	}
	return e.Err.Error()
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// decodeBody reads a size-limited JSON body and rejects unknown fields, so a
// typo'd field name fails loudly instead of defaulting to zero.
func decodeBody(r *http.Request, dst any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return apperr.InvalidInput("request body is not valid JSON for this endpoint: %v", err)
	}
	return nil
}

// CreateEscrow handles POST /escrow.
func (h *Handler) CreateEscrow(w http.ResponseWriter, r *http.Request) {
	var req model.CreateEscrowRequest
	if err := decodeBody(r, &req); err != nil {
		h.writeError(w, r, err)
		return
	}

	escrow, err := h.svc.CreateEscrow(r.Context(), req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusCreated, escrow)
}

// GetEscrow handles GET /escrow/{id}.
func (h *Handler) GetEscrow(w http.ResponseWriter, r *http.Request) {
	escrow, err := h.svc.GetEscrow(r.Context(), mux.Vars(r)["id"])
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, escrow)
}

// GetEscrowByProject handles GET /project/{projectId}/escrow. Added because
// the Next.js layer knows a project ID, not an escrow ID.
func (h *Handler) GetEscrowByProject(w http.ResponseWriter, r *http.Request) {
	escrow, err := h.svc.GetEscrowByProject(r.Context(), mux.Vars(r)["projectId"])
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, escrow)
}

// ApproveMilestone handles POST /escrow/{id}/approve-milestone.
func (h *Handler) ApproveMilestone(w http.ResponseWriter, r *http.Request) {
	callerID, ok := h.callerID(w, r)
	if !ok {
		return
	}

	escrow, err := h.svc.ApproveMilestone(r.Context(), mux.Vars(r)["id"], callerID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, escrow)
}

// ClaimMilestone handles POST /escrow/{id}/claim-milestone.
func (h *Handler) ClaimMilestone(w http.ResponseWriter, r *http.Request) {
	callerID, ok := h.callerID(w, r)
	if !ok {
		return
	}

	result, err := h.svc.ClaimMilestone(r.Context(), mux.Vars(r)["id"], callerID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	// 200 even when transfer.status is "pending": the claim is committed. The
	// body says which.
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) callerID(w http.ResponseWriter, r *http.Request) (string, bool) {
	var req model.MilestoneActionRequest
	if err := decodeBody(r, &req); err != nil {
		h.writeError(w, r, err)
		return "", false
	}
	if req.CallerID == "" {
		h.writeError(w, r, apperr.InvalidInput("caller_id is required"))
		return "", false
	}
	return req.CallerID, true
}

// Health handles GET /healthz — liveness only. It deliberately does not touch
// Supabase: a probe failing on a transient blip just gets the pod killed.
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// NotFound and MethodNotAllowed keep unrouted requests in the same envelope,
// so a client never parses two error shapes.
func (h *Handler) NotFound(w http.ResponseWriter, r *http.Request) {
	h.writeError(w, r, apperr.NotFound("no route for %s %s", r.Method, r.URL.Path))
}

func (h *Handler) MethodNotAllowed(w http.ResponseWriter, r *http.Request) {
	h.writeError(w, r, apperr.New(apperr.CodeInvalidInput, http.StatusMethodNotAllowed,
		"method %s is not allowed on %s", r.Method, r.URL.Path))
}
