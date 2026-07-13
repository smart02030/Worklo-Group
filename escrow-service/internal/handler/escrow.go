package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/worklo/escrow-service/internal/model"
	"github.com/worklo/escrow-service/internal/service"
)

// Handler holds HTTP handler methods for the escrow service.
type Handler struct {
	svc *service.Service
}

// New creates a Handler backed by svc.
func New(svc *service.Service) *Handler {
	return &Handler{svc: svc}
}

// errorResponse writes a JSON error body with the given status code.
func errorResponse(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// jsonResponse writes a JSON body with HTTP 200.
func jsonResponse(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// statusForErr maps service sentinel errors to HTTP status codes.
func statusForErr(err error) int {
	switch {
	case errors.Is(err, service.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, service.ErrForbidden):
		return http.StatusForbidden
	case errors.Is(err, service.ErrInvalidInput):
		return http.StatusBadRequest
	case errors.Is(err, service.ErrInvalidState):
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

// CreateEscrow handles POST /escrow.
func (h *Handler) CreateEscrow(w http.ResponseWriter, r *http.Request) {
	var req model.CreateEscrowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errorResponse(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	escrow, err := h.svc.CreateEscrow(r.Context(), req)
	if err != nil {
		errorResponse(w, statusForErr(err), err.Error())
		return
	}

	jsonResponse(w, http.StatusCreated, escrow)
}

// GetEscrow handles GET /escrow/{id}.
func (h *Handler) GetEscrow(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	escrow, err := h.svc.GetEscrow(r.Context(), id)
	if err != nil {
		errorResponse(w, statusForErr(err), err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, escrow)
}

// ApproveMilestone handles POST /escrow/{id}/approve-milestone.
func (h *Handler) ApproveMilestone(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	var req model.MilestoneActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errorResponse(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.CallerID == "" {
		errorResponse(w, http.StatusBadRequest, "caller_id is required")
		return
	}

	escrow, err := h.svc.ApproveMilestone(r.Context(), id, req.CallerID)
	if err != nil {
		errorResponse(w, statusForErr(err), err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, escrow)
}

// ClaimMilestone handles POST /escrow/{id}/claim-milestone.
func (h *Handler) ClaimMilestone(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	var req model.MilestoneActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errorResponse(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.CallerID == "" {
		errorResponse(w, http.StatusBadRequest, "caller_id is required")
		return
	}

	escrow, err := h.svc.ClaimMilestone(r.Context(), id, req.CallerID)
	if err != nil {
		errorResponse(w, statusForErr(err), err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, escrow)
}
