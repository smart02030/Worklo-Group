package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/worklo/escrow-service/internal/model"
)

// Repository handles persistence of Escrow records via Supabase REST API.
type Repository struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

// New creates a Repository backed by the given Supabase project.
func New(supabaseURL, serviceRoleKey string) *Repository {
	return &Repository{
		baseURL: strings.TrimRight(supabaseURL, "/") + "/rest/v1",
		apiKey:  serviceRoleKey,
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

func (r *Repository) do(req *http.Request) (*http.Response, error) {
	req.Header.Set("apikey", r.apiKey)
	req.Header.Set("Authorization", "Bearer "+r.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	return r.client.Do(req)
}

// Create inserts a new escrow row and returns the created record.
func (r *Repository) Create(ctx context.Context, e *model.Escrow) (*model.Escrow, error) {
	body, err := json.Marshal(e)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.baseURL+"/escrows", strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}

	resp, err := r.do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("create escrow: unexpected status %d", resp.StatusCode)
	}

	var created []model.Escrow
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		return nil, err
	}
	if len(created) == 0 {
		return nil, fmt.Errorf("create escrow: empty response")
	}
	return &created[0], nil
}

// GetByID fetches a single escrow by primary key.
func (r *Repository) GetByID(ctx context.Context, id string) (*model.Escrow, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		r.baseURL+"/escrows?id=eq."+id+"&limit=1", nil)
	if err != nil {
		return nil, err
	}

	resp, err := r.do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var rows []model.Escrow
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil // caller checks for nil → 404
	}
	return &rows[0], nil
}

// Update persists changed fields of an escrow (optimistic, full-record patch).
func (r *Repository) Update(ctx context.Context, e *model.Escrow) error {
	body, err := json.Marshal(e)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPatch,
		r.baseURL+"/escrows?id=eq."+e.ID, strings.NewReader(string(body)))
	if err != nil {
		return err
	}

	resp, err := r.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("update escrow: unexpected status %d", resp.StatusCode)
	}
	return nil
}
