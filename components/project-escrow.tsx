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
 */

import { useCallback, useEffect, useState } from 'react';
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
  status: 'pending' | 'active' | 'completed' | 'cancelled';
}

/** Payout status attached to a successful claim by the Go service. */
interface TransferInfo {
  id: string;
  milestone_index: number;
  amount_cents: number;
  status: 'pending' | 'sent' | 'failed';
}

type ClaimResponse = EscrowState & { transfer?: TransferInfo };

interface ProjectEscrowProps {
  projectId: string;
  /** Current user ID — used to determine which actions to surface */
  currentUserId: string;
  /** Contractor user ID pre-populated from the Worklo project */
  contractorId: string;
}

/** Which async action is in flight — one at a time, so the buttons can't race. */
type PendingAction = 'load' | 'create' | 'approve' | 'claim' | null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatCents = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

/**
 * Pulls a usable message out of an error response, so the user sees "no
 * approved milestone available to claim (1 approved, 1 claimed)" rather than a
 * bare status code.
 */
async function errorMessageFrom(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string') return body.error;
    if (typeof body?.error?.message === 'string') return body.error.message;
  } catch {
    // Non-JSON body — fall through.
  }
  return `${fallback} (${res.status})`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectEscrow({ projectId, currentUserId, contractorId }: ProjectEscrowProps) {
  const [escrow, setEscrow] = useState<EscrowState | null>(null);
  const [pending, setPending] = useState<PendingAction>('load');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Create Escrow form state
  const [totalMilestones, setTotalMilestones] = useState('');
  const [amountPerMilestone, setAmountPerMilestone] = useState('');

  const fetchEscrow = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/escrow`, { cache: 'no-store' });
      if (res.status === 404) {
        setEscrow(null);
        return;
      }
      if (!res.ok) {
        throw new Error(await errorMessageFrom(res, 'Failed to load escrow'));
      }
      setEscrow(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [projectId]);

  // Fetch on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPending('load');
      await fetchEscrow();
      // Guard against a late response from a previous project landing in state.
      if (!cancelled) setPending(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchEscrow]);

  const handleCreateEscrow = async () => {
    setError(null);
    setNotice(null);

    const total = Number(totalMilestones);
    const amount = Number(amountPerMilestone);

    if (!Number.isInteger(total) || total < 1) {
      setError('Total milestones must be a whole number of at least 1.');
      return;
    }
    // Cents, not dollars — the service stores an integer.
    if (!Number.isInteger(amount) || amount < 1) {
      setError('Amount per milestone must be a whole number of cents (e.g. 50000 for $500).');
      return;
    }

    setPending('create');
    try {
      const res = await fetch(`/api/projects/${projectId}/escrow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totalMilestones: total,
          amountPerMilestone: amount,
          contractorId,
        }),
      });
      if (!res.ok) {
        throw new Error(await errorMessageFrom(res, 'Failed to create escrow'));
      }
      setTotalMilestones('');
      setAmountPerMilestone('');
      setNotice(`Escrow created for ${formatCents(total * amount)}.`);
      await fetchEscrow();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPending(null);
    }
  };

  const handleApproveMilestone = async () => {
    setError(null);
    setNotice(null);
    setPending('approve');
    try {
      const res = await fetch(`/api/projects/${projectId}/escrow/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerId: currentUserId }),
      });
      if (!res.ok) {
        // 403 = not the client on this escrow; 409 = nothing left to approve.
        throw new Error(await errorMessageFrom(res, 'Failed to approve milestone'));
      }
      setNotice('Milestone approved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      // Refetch even on failure: a 409 usually means our view of the escrow is
      // stale, and the fresh state is what explains the rejection.
      await fetchEscrow();
      setPending(null);
    }
  };

  const handleClaimMilestone = async () => {
    setError(null);
    setNotice(null);
    setPending('claim');
    try {
      const res = await fetch(`/api/projects/${projectId}/escrow/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerId: currentUserId }),
      });
      if (!res.ok) {
        throw new Error(await errorMessageFrom(res, 'Failed to claim milestone'));
      }

      const result: ClaimResponse = await res.json();
      // The claim is committed either way; say plainly whether money moved.
      setNotice(
        result.transfer?.status === 'sent'
          ? `Milestone claimed — ${formatCents(result.transfer.amount_cents)} paid out.`
          : 'Milestone claimed. The payout is queued and will be retried automatically.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      await fetchEscrow();
      setPending(null);
    }
  };

  const isClient = escrow?.client_id === currentUserId;
  const isContractor = escrow?.contractor_id === currentUserId || contractorId === currentUserId;
  const busy = pending !== null;

  const claimable = escrow ? escrow.milestones_approved - escrow.milestones_claimed : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Escrow</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && !error && <p className="text-sm text-muted-foreground">{notice}</p>}

        {/* Escrow state display */}
        {pending === 'load' && !escrow ? (
          <p className="text-sm text-muted-foreground">Loading escrow…</p>
        ) : escrow ? (
          <div className="space-y-2 text-sm">
            <p>
              Status: <span className="font-medium">{escrow.status}</span>
            </p>
            <p>
              Milestones: {escrow.milestones_claimed} / {escrow.total_milestones} claimed
            </p>
            <p>
              Approved: {escrow.milestones_approved}
              {claimable > 0 && (
                <span className="text-muted-foreground"> ({claimable} ready to claim)</span>
              )}
            </p>
            <p>Per milestone: {formatCents(escrow.amount_per_milestone)}</p>
            <p className="text-muted-foreground">
              Remaining in escrow:{' '}
              {formatCents(
                escrow.amount_per_milestone * (escrow.total_milestones - escrow.milestones_claimed),
              )}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No escrow created yet.</p>
        )}

        {/* Create Escrow form — only show if no escrow exists */}
        {!escrow && pending !== 'load' && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Create Escrow</h3>
            <input
              type="number"
              min="1"
              step="1"
              placeholder="Total milestones"
              value={totalMilestones}
              onChange={(e) => setTotalMilestones(e.target.value)}
              disabled={busy}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <input
              type="number"
              min="1"
              step="1"
              placeholder="Amount per milestone (in cents)"
              value={amountPerMilestone}
              onChange={(e) => setAmountPerMilestone(e.target.value)}
              disabled={busy}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <Button onClick={handleCreateEscrow} disabled={busy} className="w-full">
              {pending === 'create' ? 'Creating…' : 'Create Escrow'}
            </Button>
          </div>
        )}

        {/* Approve Milestone — only show to the client when milestones remain */}
        {escrow &&
          isClient &&
          escrow.status === 'active' &&
          escrow.milestones_approved < escrow.total_milestones && (
            <Button
              onClick={handleApproveMilestone}
              disabled={busy}
              variant="outline"
              className="w-full"
            >
              {pending === 'approve' ? 'Approving…' : 'Approve Next Milestone'}
            </Button>
          )}

        {/* Claim Milestone — only show to the contractor when approved > claimed */}
        {escrow && isContractor && escrow.status === 'active' && claimable > 0 && (
          <Button onClick={handleClaimMilestone} disabled={busy} className="w-full">
            {pending === 'claim'
              ? 'Claiming…'
              : `Claim Milestone (${formatCents(escrow.amount_per_milestone)})`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
