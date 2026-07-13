package model

import "time"

// Status represents the lifecycle state of an escrow.
type Status string

const (
	StatusPending   Status = "pending"
	StatusActive    Status = "active"
	StatusCompleted Status = "completed"
	StatusCancelled Status = "cancelled"
)

// Escrow holds the milestone escrow state for a Worklo project.
type Escrow struct {
	ID                  string    `json:"id"`
	ProjectID           string    `json:"project_id"`
	ClientID            string    `json:"client_id"`
	ContractorID        string    `json:"contractor_id"`
	TotalMilestones     int       `json:"total_milestones"`
	MilestonesApproved  int       `json:"milestones_approved"`
	MilestonesClaimed   int       `json:"milestones_claimed"`
	AmountPerMilestone  int64     `json:"amount_per_milestone"` // in cents
	Status              Status    `json:"status"`
	CreatedAt           time.Time `json:"created_at"`
}

// CreateEscrowRequest is the payload for POST /escrow.
type CreateEscrowRequest struct {
	ProjectID          string `json:"project_id"`
	ClientID           string `json:"client_id"`
	ContractorID       string `json:"contractor_id"`
	TotalMilestones    int    `json:"total_milestones"`
	AmountPerMilestone int64  `json:"amount_per_milestone"`
}

// MilestoneActionRequest carries the caller's identity for milestone operations.
type MilestoneActionRequest struct {
	CallerID string `json:"caller_id"`
}
