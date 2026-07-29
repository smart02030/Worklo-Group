// Package repository persists escrows through the Supabase REST API.
//
// Reads and inserts use the table endpoint; milestone mutations go through
// Postgres functions via /rpc. PostgREST is one HTTP request per statement and
// cannot hold a transaction across two, so a read-then-write here would always
// be a lost-update race. See supabase/escrow-rpc.sql.
package repository

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/worklo/escrow-service/internal/apperr"
	"github.com/worklo/escrow-service/internal/model"
)

// maxErrorBody caps how much of an upstream error response we read into logs.
const maxErrorBody = 2 << 10

// Repository handles persistence of Escrow records via the Supabase REST API.
type Repository struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

// New creates a Repository backed by the given Supabase project.
func New(supabaseURL, serviceRoleKey string, timeout time.Duration) *Repository {
	return &Repository{
		baseURL: strings.TrimRight(supabaseURL, "/") + "/rest/v1",
		apiKey:  serviceRoleKey,
		client:  &http.Client{Timeout: timeout},
	}
}

func (r *Repository) send(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, apperr.Internal(err, "encoding request body")
		}
		reader = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, r.baseURL+path, reader)
	if err != nil {
		return nil, apperr.Internal(err, "building upstream request")
	}
	req.Header.Set("apikey", r.apiKey)
	req.Header.Set("Authorization", "Bearer "+r.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, apperr.Upstream(err, "supabase request failed")
	}
	return resp, nil
}

// upstreamError wraps a non-2xx response. The body goes to the internal cause
// (logs only) — PostgREST error text can echo schema details.
func upstreamError(resp *http.Response, op string) error {
	snippet, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBody))
	return apperr.Upstream(
		fmt.Errorf("status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(snippet))),
		"%s failed upstream", op,
	)
}

// Create inserts a new escrow row and returns the created record.
func (r *Repository) Create(ctx context.Context, e *model.Escrow) (*model.Escrow, error) {
	resp, err := r.send(ctx, http.MethodPost, "/escrows", e)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// Unique violation against the partial index: project already has an escrow.
	if resp.StatusCode == http.StatusConflict {
		return nil, apperr.Conflict(apperr.CodeEscrowExistsAlrdy,
			"an escrow already exists for project %s", e.ProjectID)
	}
	if resp.StatusCode != http.StatusCreated {
		return nil, upstreamError(resp, "create escrow")
	}

	var created []model.Escrow
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		return nil, apperr.Upstream(err, "decoding created escrow")
	}
	if len(created) == 0 {
		return nil, apperr.Upstream(nil, "create escrow returned no rows")
	}
	return &created[0], nil
}

// GetByID fetches an escrow by primary key. A missing row returns (nil, nil);
// an upstream failure returns an error — conflating them turns an outage into
// a misleading 404.
func (r *Repository) GetByID(ctx context.Context, id string) (*model.Escrow, error) {
	return r.getOne(ctx, "/escrows?id=eq."+url.QueryEscape(id)+"&limit=1", "get escrow")
}

// GetByProjectID returns the live (non-cancelled) escrow for a project.
func (r *Repository) GetByProjectID(ctx context.Context, projectID string) (*model.Escrow, error) {
	path := "/escrows?project_id=eq." + url.QueryEscape(projectID) +
		"&status=neq.cancelled&order=created_at.desc&limit=1"
	return r.getOne(ctx, path, "get escrow by project")
}

func (r *Repository) getOne(ctx context.Context, path, op string) (*model.Escrow, error) {
	resp, err := r.send(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, upstreamError(resp, op)
	}

	var rows []model.Escrow
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, apperr.Upstream(err, "decoding escrow rows")
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return &rows[0], nil
}

func (r *Repository) callRPC(ctx context.Context, fn string, args map[string]any, op string) (*model.MutationResult, error) {
	resp, err := r.send(ctx, http.MethodPost, "/rpc/"+fn, args)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, upstreamError(resp, op)
	}

	var result model.MutationResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, apperr.Upstream(err, "decoding %s result", op)
	}
	if result.Code == "" {
		return nil, apperr.Upstream(nil, "%s returned no result code", op)
	}
	return &result, nil
}

// ApproveMilestone runs the atomic approval statement.
func (r *Repository) ApproveMilestone(ctx context.Context, id, callerID string) (*model.MutationResult, error) {
	return r.callRPC(ctx, "escrow_approve_milestone", map[string]any{
		"p_escrow_id": id,
		"p_caller_id": callerID,
	}, "approve milestone")
}

// ClaimMilestone runs the atomic claim, which also writes the outbox row in
// the same transaction.
func (r *Repository) ClaimMilestone(ctx context.Context, id, callerID string) (*model.MutationResult, error) {
	return r.callRPC(ctx, "escrow_claim_milestone", map[string]any{
		"p_escrow_id": id,
		"p_caller_id": callerID,
	}, "claim milestone")
}

// SettleTransfer records the outcome of a transfer attempt.
func (r *Repository) SettleTransfer(ctx context.Context, transferID string, status model.TransferStatus, lastErr string) error {
	_, err := r.callRPC(ctx, "escrow_settle_transfer", map[string]any{
		"p_transfer_id": transferID,
		"p_status":      string(status),
		"p_error":       lastErr,
	}, "settle transfer")
	return err
}
