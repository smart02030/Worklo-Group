'use client';

/**
 * ProjectEscrow — milestone escrow UI for a Worklo project.
 *
 * Responsibilities:
 *   - Display current escrow state (fetched from GET /api/projects/[projectId]/escrow)
 *   - "Create Escrow" form: calls POST route and shows the created escrow
 *   - "Approve Milestone" button (client only): calls approve-milestone endpoint
 *   - "Claim Milestone" button (contractor only): calls claim-milestone endpoint
 *   - After each action, re-fetches escrow state
 *
 * Error handling requirements:
 *   - Show meaningful error messages for API failures
 *   - Loading states on all async actions
 *
 * TODO: implement
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EscrowState {
  id: string;
  project_id: string;
  client_id: string;
  contractor_id: string;
  total_milestones: number;
  milestones_approved: number;
  milestones_claimed: number;
  amount_per_milestone: number; // in cents
  status: 'active' | 'completed' | 'cancelled';
}

interface ProjectEscrowProps {
  projectId: string;
  /** Current user ID — used to determine which actions to surface */
  currentUserId: string;
  /** Contractor user ID pre-populated from the Worklo project */
  contractorId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectEscrow({ projectId, currentUserId, contractorId }: ProjectEscrowProps) {
  const [escrow, setEscrow] = useState<EscrowState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create Escrow form state
  const [totalMilestones, setTotalMilestones] = useState('');
  const [amountPerMilestone, setAmountPerMilestone] = useState('');

  const fetchEscrow = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/escrow`);
      if (res.status === 404) {
        setEscrow(null);
        return;
      }
      if (!res.ok) throw new Error(`Failed to fetch escrow: ${res.statusText}`);
      setEscrow(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  // Fetch on mount
  useEffect(() => {
    fetchEscrow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // TODO: implement handleCreateEscrow
  //   1. Validate totalMilestones and amountPerMilestone
  //   2. POST /api/projects/[projectId]/escrow with { totalMilestones, amountPerMilestone, contractorId }
  //   3. On success, call fetchEscrow() to refresh state
  const handleCreateEscrow = async () => {
    // TODO
  };

  // TODO: implement handleApproveMilestone
  //   1. POST /api/projects/[projectId]/escrow/approve with { callerId: currentUserId }
  //   2. On success, call fetchEscrow() to refresh state
  //   3. Show error if caller is not the client
  const handleApproveMilestone = async () => {
    // TODO
  };

  // TODO: implement handleClaimMilestone
  //   1. POST /api/projects/[projectId]/escrow/claim with { callerId: currentUserId }
  //   2. On success, call fetchEscrow() to refresh state
  //   3. Show error if caller is not the contractor or no approved milestones remain
  const handleClaimMilestone = async () => {
    // TODO
  };

  const isClient = escrow?.client_id === currentUserId;
  const isContractor = escrow?.contractor_id === currentUserId || contractorId === currentUserId;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Escrow</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p className="text-destructive text-sm">{error}</p>
        )}

        {/* Escrow state display */}
        {escrow ? (
          <div className="space-y-2 text-sm">
            <p>Status: <span className="font-medium">{escrow.status}</span></p>
            <p>Milestones: {escrow.milestones_claimed} / {escrow.total_milestones} claimed</p>
            <p>Approved: {escrow.milestones_approved}</p>
            <p>Per milestone: {(escrow.amount_per_milestone / 100).toFixed(2)} USD</p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No escrow created yet.</p>
        )}

        {/* Create Escrow form — only show if no escrow exists */}
        {!escrow && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Create Escrow</h3>
            <input
              type="number"
              placeholder="Total milestones"
              value={totalMilestones}
              onChange={(e) => setTotalMilestones(e.target.value)}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Amount per milestone (in cents)"
              value={amountPerMilestone}
              onChange={(e) => setAmountPerMilestone(e.target.value)}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <Button onClick={handleCreateEscrow} disabled={loading} className="w-full">
              {loading ? 'Creating…' : 'Create Escrow'}
            </Button>
          </div>
        )}

        {/* Approve Milestone — only show to the client when milestones remain */}
        {escrow && isClient && escrow.milestones_approved < escrow.total_milestones && (
          <Button onClick={handleApproveMilestone} disabled={loading} variant="outline" className="w-full">
            {loading ? 'Approving…' : 'Approve Next Milestone'}
          </Button>
        )}

        {/* Claim Milestone — only show to the contractor when approved > claimed */}
        {escrow && isContractor && escrow.milestones_approved > escrow.milestones_claimed && (
          <Button onClick={handleClaimMilestone} disabled={loading} className="w-full">
            {loading ? 'Claiming…' : 'Claim Milestone'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
