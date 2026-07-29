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
	ID                 string    `json:"id"`
	ProjectID          string    `json:"project_id"`
	ClientID           string    `json:"client_id"`
	ContractorID       string    `json:"contractor_id"`
	TotalMilestones    int       `json:"total_milestones"`
	MilestonesApproved int       `json:"milestones_approved"`
	MilestonesClaimed  int       `json:"milestones_claimed"`
	AmountPerMilestone int64     `json:"amount_per_milestone"` // in cents
	Status             Status    `json:"status"`
	CreatedAt          time.Time `json:"created_at"`
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

// ResultCode says why a guarded UPDATE matched no rows, so the HTTP layer can
// answer 403 vs 404 vs 409 without a second round trip.
type ResultCode string

const (
	CodeOK                    ResultCode = "OK"
	CodeNotFound              ResultCode = "NOT_FOUND"
	CodeForbidden             ResultCode = "FORBIDDEN"
	CodeEscrowNotActive       ResultCode = "ESCROW_NOT_ACTIVE"
	CodeAllMilestonesApproved ResultCode = "ALL_MILESTONES_APPROVED"
	CodeNoApprovedMilestone   ResultCode = "NO_APPROVED_MILESTONE"
)

// MutationResult is the decoded return value of a milestone RPC.
type MutationResult struct {
	Code   ResultCode `json:"code"`
	Escrow *Escrow    `json:"escrow"`
	// set only by the claim RPC, and only when Code is OK
	TransferID     string `json:"transfer_id"`
	MilestoneIndex int    `json:"milestone_index"`
}

// TransferStatus is the settlement state of an outbox row.
type TransferStatus string

const (
	TransferPending TransferStatus = "pending"
	TransferSent    TransferStatus = "sent"
	TransferFailed  TransferStatus = "failed"
)

// ClaimResult is the new escrow state plus the status of the payment it
// triggered. The embedded pointer flattens, keeping escrow fields top-level.
type ClaimResult struct {
	*Escrow
	Transfer TransferInfo `json:"transfer"`
}

// TransferInfo describes the payment attempt attached to a claim.
type TransferInfo struct {
	ID             string         `json:"id"`
	MilestoneIndex int            `json:"milestone_index"`
	AmountCents    int64          `json:"amount_cents"`
	Status         TransferStatus `json:"status"`
}
