-- =============================================================
-- ESCROW RPC  (atomic milestone mutations + transfer outbox)
-- Run AFTER supabase/schema.sql (or supabase/escrows.sql). Safe to re-run.
--
-- Every milestone mutation is a SINGLE guarded UPDATE. Postgres row-locks for
-- the statement and under READ COMMITTED re-evaluates the WHERE against the
-- newly committed row, so two callers can never both read N and write N+1.
-- =============================================================

-- One live escrow per project; cancelled ones do not block a replacement.
CREATE UNIQUE INDEX IF NOT EXISTS idx_escrows_one_live_per_project
  ON escrows (project_id)
  WHERE status <> 'cancelled';

-- Transfer outbox. A row is inserted in the SAME transaction that increments
-- milestones_claimed; UNIQUE (escrow_id, milestone_index) makes a second
-- payment for one milestone structurally impossible.
CREATE TABLE IF NOT EXISTS escrow_transfers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id        UUID NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
  milestone_index  INT NOT NULL CHECK (milestone_index > 0),
  contractor_id    UUID NOT NULL,
  amount_cents     BIGINT NOT NULL CHECK (amount_cents > 0),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sent', 'failed')),
  attempts         INT NOT NULL DEFAULT 0,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (escrow_id, milestone_index)
);

-- Retry worker's working set: everything owed but not yet paid.
CREATE INDEX IF NOT EXISTS idx_escrow_transfers_unsettled
  ON escrow_transfers (created_at)
  WHERE status <> 'sent';

ALTER TABLE escrow_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "escrow_transfers_service_role_all" ON escrow_transfers;
CREATE POLICY "escrow_transfers_service_role_all" ON escrow_transfers
  USING (TRUE) WITH CHECK (TRUE);

-- escrow_approve_milestone — returns a discriminated result rather than
-- raising, so the service maps a precise HTTP status without a second trip:
--   OK | NOT_FOUND | FORBIDDEN | ESCROW_NOT_ACTIVE | ALL_MILESTONES_APPROVED
CREATE OR REPLACE FUNCTION escrow_approve_milestone(
  p_escrow_id UUID,
  p_caller_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_escrow escrows%ROWTYPE;
BEGIN
  -- One statement; every guard lives in the WHERE so it is evaluated under
  -- the row lock, not before it.
  UPDATE escrows
     SET milestones_approved = milestones_approved + 1
   WHERE id     = p_escrow_id
     AND client_id = p_caller_id
     AND status = 'active'
     AND milestones_approved < total_milestones
  RETURNING * INTO v_escrow;

  IF FOUND THEN
    RETURN jsonb_build_object('code', 'OK', 'escrow', to_jsonb(v_escrow));
  END IF;

  -- Matched nothing: read the row back to explain why. Advisory only — under
  -- concurrency this may be stale, but it only affects which 4xx we return.
  SELECT * INTO v_escrow FROM escrows WHERE id = p_escrow_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  IF v_escrow.client_id <> p_caller_id THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN', 'escrow', to_jsonb(v_escrow));
  END IF;
  IF v_escrow.status <> 'active' THEN
    RETURN jsonb_build_object('code', 'ESCROW_NOT_ACTIVE', 'escrow', to_jsonb(v_escrow));
  END IF;
  RETURN jsonb_build_object('code', 'ALL_MILESTONES_APPROVED', 'escrow', to_jsonb(v_escrow));
END;
$$;

-- escrow_claim_milestone — increments milestones_claimed AND writes the outbox
-- row in one transaction, so the service can never owe a payment it has no
-- durable record of.
-- Codes: OK | NOT_FOUND | FORBIDDEN | ESCROW_NOT_ACTIVE | NO_APPROVED_MILESTONE
CREATE OR REPLACE FUNCTION escrow_claim_milestone(
  p_escrow_id UUID,
  p_caller_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_escrow      escrows%ROWTYPE;
  v_transfer_id UUID;
BEGIN
  UPDATE escrows
     SET milestones_claimed = milestones_claimed + 1,
         -- complete when the money is out, not when the work is signed off
         status = CASE
                    WHEN milestones_claimed + 1 = total_milestones THEN 'completed'
                    ELSE status
                  END
   WHERE id            = p_escrow_id
     AND contractor_id = p_caller_id
     AND status        = 'active'
     AND milestones_claimed < milestones_approved
  RETURNING * INTO v_escrow;

  IF FOUND THEN
    -- Same transaction as the increment. milestones_claimed is the 1-based
    -- index this payment settles; the unique constraint blocks any replay.
    INSERT INTO escrow_transfers (escrow_id, milestone_index, contractor_id, amount_cents)
    VALUES (v_escrow.id, v_escrow.milestones_claimed, v_escrow.contractor_id,
            v_escrow.amount_per_milestone)
    RETURNING id INTO v_transfer_id;

    RETURN jsonb_build_object(
      'code', 'OK',
      'escrow', to_jsonb(v_escrow),
      'transfer_id', v_transfer_id,
      'milestone_index', v_escrow.milestones_claimed
    );
  END IF;

  SELECT * INTO v_escrow FROM escrows WHERE id = p_escrow_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', 'NOT_FOUND');
  END IF;
  IF v_escrow.contractor_id <> p_caller_id THEN
    RETURN jsonb_build_object('code', 'FORBIDDEN', 'escrow', to_jsonb(v_escrow));
  END IF;
  IF v_escrow.status <> 'active' THEN
    RETURN jsonb_build_object('code', 'ESCROW_NOT_ACTIVE', 'escrow', to_jsonb(v_escrow));
  END IF;
  RETURN jsonb_build_object('code', 'NO_APPROVED_MILESTONE', 'escrow', to_jsonb(v_escrow));
END;
$$;

-- escrow_settle_transfer — record a transfer attempt's outcome. 'sent' is
-- terminal; anything else stays visible to the retry worker.
CREATE OR REPLACE FUNCTION escrow_settle_transfer(
  p_transfer_id UUID,
  p_status      TEXT,
  p_error       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_found BOOLEAN;
BEGIN
  UPDATE escrow_transfers
     SET status     = p_status,
         last_error = p_error,
         attempts   = attempts + 1,
         updated_at = NOW()
   WHERE id = p_transfer_id
     AND status <> 'sent';  -- never walk a settled payment back

  v_found := FOUND;
  RETURN jsonb_build_object('code', CASE WHEN v_found THEN 'OK' ELSE 'NOT_FOUND' END);
END;
$$;
