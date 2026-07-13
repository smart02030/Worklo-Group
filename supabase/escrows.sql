-- =============================================================
-- ESCROWS  (milestone escrow — used by escrow-service)
-- Run this if you already applied schema.sql before escrows existed.
-- Safe to re-run (IF NOT EXISTS).
-- =============================================================

CREATE TABLE IF NOT EXISTS escrows (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_id              UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  contractor_id          UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  total_milestones       INT NOT NULL CHECK (total_milestones > 0),
  milestones_approved    INT NOT NULL DEFAULT 0 CHECK (milestones_approved >= 0),
  milestones_claimed     INT NOT NULL DEFAULT 0 CHECK (milestones_claimed >= 0),
  amount_per_milestone   BIGINT NOT NULL CHECK (amount_per_milestone > 0),
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (milestones_approved <= total_milestones),
  CHECK (milestones_claimed <= milestones_approved)
);

CREATE INDEX IF NOT EXISTS idx_escrows_project_id ON escrows(project_id);
CREATE INDEX IF NOT EXISTS idx_escrows_client_id ON escrows(client_id);
CREATE INDEX IF NOT EXISTS idx_escrows_contractor_id ON escrows(contractor_id);
CREATE INDEX IF NOT EXISTS idx_escrows_status ON escrows(status);

ALTER TABLE escrows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "escrows_service_role_all" ON escrows;
CREATE POLICY "escrows_service_role_all" ON escrows
  USING (TRUE) WITH CHECK (TRUE);
