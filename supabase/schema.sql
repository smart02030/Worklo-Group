
-- =============================================================
-- WORKLO / NIXORA - COMPLETE DATABASE SCHEMA
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- =============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- HELPER: auto-update updated_at on every UPDATE
-- =============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- 1. DEPARTMENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_departments_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "departments_service_role_all" ON departments
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 2. ROLES
-- =============================================================
CREATE TABLE IF NOT EXISTS roles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  description       TEXT,
  department_id     UUID REFERENCES departments(id) ON DELETE SET NULL,
  permissions       JSONB NOT NULL DEFAULT '{}',
  hierarchy_level   INTEGER NOT NULL DEFAULT 0,
  reporting_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  is_system_role    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_roles_department_id ON roles(department_id);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roles_service_role_all" ON roles
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 3. USER PROFILES
-- (mirrors auth.users — populated via trigger on signup)
-- =============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id                      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                   TEXT NOT NULL UNIQUE,
  name                    TEXT,
  image                   TEXT,
  bio                     TEXT,
  skills                  TEXT[] NOT NULL DEFAULT '{}',
  is_superadmin           BOOLEAN NOT NULL DEFAULT FALSE,
  is_client               BOOLEAN NOT NULL DEFAULT FALSE,
  client_account_id       UUID,  -- FK added after accounts table
  client_contact_name     TEXT,
  client_company_position TEXT,
  workload_sentiment      TEXT CHECK (workload_sentiment IN ('comfortable','stretched','overwhelmed')),
  has_completed_onboarding BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profiles_service_role_all" ON user_profiles
  USING (TRUE) WITH CHECK (TRUE);

-- Allow users to read their own profile
CREATE POLICY "user_profiles_read_own" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

-- =============================================================
-- 4. USER ROLES  (junction: user ↔ role, soft-deletable)
-- =============================================================
CREATE TABLE IF NOT EXISTS user_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id   ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id   ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_active     ON user_roles(user_id, role_id) WHERE removed_at IS NULL;

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_roles_service_role_all" ON user_roles
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 5. ACCOUNTS  (client accounts / companies)
-- =============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  description           TEXT,
  status                TEXT NOT NULL DEFAULT 'planning'
                          CHECK (status IN ('planning','in_progress','review','complete','on_hold')),
  primary_contact_name  TEXT,
  primary_contact_email TEXT,
  account_manager_id    UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  service_tier          TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_accounts_account_manager ON accounts(account_manager_id);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts_service_role_all" ON accounts
  USING (TRUE) WITH CHECK (TRUE);

-- Now that accounts exists, add the FK on user_profiles
ALTER TABLE user_profiles
  ADD CONSTRAINT fk_user_profiles_client_account
  FOREIGN KEY (client_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

-- =============================================================
-- 6. ACCOUNT MEMBERS  (junction: account ↔ user, soft-deletable)
-- =============================================================
CREATE TABLE IF NOT EXISTS account_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  role_in_account TEXT,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_account_members_account ON account_members(account_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_account_members_user    ON account_members(user_id)    WHERE removed_at IS NULL;

ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_members_service_role_all" ON account_members
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 7. ACCOUNT KANBAN CONFIGS
-- =============================================================
CREATE TABLE IF NOT EXISTS account_kanban_configs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  columns    JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_account_kanban_configs_updated_at
  BEFORE UPDATE ON account_kanban_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE account_kanban_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_kanban_configs_service_role_all" ON account_kanban_configs
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 8. PROJECTS
-- =============================================================
CREATE TABLE IF NOT EXISTS projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'planning'
                    CHECK (status IN ('planning','in_progress','review','complete','on_hold')),
  priority        TEXT NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low','medium','high','urgent')),
  start_date      DATE,
  end_date        DATE,
  estimated_hours NUMERIC(10,2),
  actual_hours    NUMERIC(10,2),
  created_by      UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  assigned_user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_projects_account_id  ON projects(account_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_by  ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_status      ON projects(status);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_service_role_all" ON projects
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 9. PROJECT ASSIGNMENTS  (junction: project ↔ user, soft-deletable)
-- =============================================================
CREATE TABLE IF NOT EXISTS project_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  role_in_project TEXT,
  assigned_by     UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_project_assignments_updated_at
  BEFORE UPDATE ON project_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_project_assignments_project ON project_assignments(project_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_assignments_user    ON project_assignments(user_id)    WHERE removed_at IS NULL;

ALTER TABLE project_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_assignments_service_role_all" ON project_assignments
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 10. PROJECT STAKEHOLDERS
-- =============================================================
CREATE TABLE IF NOT EXISTS project_stakeholders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  role        TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_stakeholders_project ON project_stakeholders(project_id);

ALTER TABLE project_stakeholders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_stakeholders_service_role_all" ON project_stakeholders
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 11. PROJECT UPDATES
-- =============================================================
CREATE TABLE IF NOT EXISTS project_updates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_project_updates_updated_at
  BEFORE UPDATE ON project_updates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_project_updates_project ON project_updates(project_id);

ALTER TABLE project_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_updates_service_role_all" ON project_updates
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 12. PROJECT ISSUES
-- =============================================================
CREATE TABLE IF NOT EXISTS project_issues (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','in_progress','resolved')),
  created_by          UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  resolved_by         UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  resolved_at         TIMESTAMPTZ,
  workflow_history_id UUID,  -- FK added after workflow_history table
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_project_issues_updated_at
  BEFORE UPDATE ON project_issues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_project_issues_project ON project_issues(project_id);
CREATE INDEX IF NOT EXISTS idx_project_issues_status  ON project_issues(status);

ALTER TABLE project_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_issues_service_role_all" ON project_issues
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 13. MILESTONES
-- =============================================================
CREATE TABLE IF NOT EXISTS milestones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  date        TIMESTAMPTZ NOT NULL,
  color       TEXT NOT NULL DEFAULT '#3b82f6',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_milestones_updated_at
  BEFORE UPDATE ON milestones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milestones_service_role_all" ON milestones
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 14. TASKS
-- =============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'todo'
                    CHECK (status IN ('todo','in_progress','done','complete')),
  priority        TEXT CHECK (priority IN ('low','medium','high','urgent')),
  assigned_to     UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_by      UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  due_date        DATE,
  estimated_hours NUMERIC(10,2),
  remaining_hours NUMERIC(10,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_tasks_project_id  ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_service_role_all" ON tasks
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 15. TASK WEEK ALLOCATIONS
-- =============================================================
CREATE TABLE IF NOT EXISTS task_week_allocations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  assigned_user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  week_start_date  DATE NOT NULL,
  allocated_hours  NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_task_week_allocations_updated_at
  BEFORE UPDATE ON task_week_allocations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_task_week_alloc_task ON task_week_allocations(task_id);
CREATE INDEX IF NOT EXISTS idx_task_week_alloc_user ON task_week_allocations(assigned_user_id, week_start_date);

ALTER TABLE task_week_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_week_allocations_service_role_all" ON task_week_allocations
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 16. TIME ENTRIES
-- =============================================================
CREATE TABLE IF NOT EXISTS time_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID REFERENCES tasks(id) ON DELETE SET NULL,
  user_id         UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hours_logged    NUMERIC(10,2) NOT NULL,
  entry_date      DATE NOT NULL,
  week_start_date DATE NOT NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_time_entries_updated_at
  BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_time_entries_user_week    ON time_entries(user_id, week_start_date);
CREATE INDEX IF NOT EXISTS idx_time_entries_project      ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_task         ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_entry_date   ON time_entries(entry_date);

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "time_entries_service_role_all" ON time_entries
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 17. CLOCK SESSIONS
-- =============================================================
CREATE TABLE IF NOT EXISTS clock_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  task_id          UUID REFERENCES tasks(id) ON DELETE SET NULL,
  project_id       UUID REFERENCES projects(id) ON DELETE SET NULL,
  start_time       TIMESTAMPTZ NOT NULL,
  end_time         TIMESTAMPTZ,
  duration_minutes INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clock_sessions_user ON clock_sessions(user_id);

ALTER TABLE clock_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clock_sessions_service_role_all" ON clock_sessions
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 18. USER AVAILABILITY
-- =============================================================
CREATE TABLE IF NOT EXISTS user_availability (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  available_hours NUMERIC(10,2) NOT NULL DEFAULT 40,
  schedule_data   JSONB,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, week_start_date)
);

CREATE TRIGGER trg_user_availability_updated_at
  BEFORE UPDATE ON user_availability
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_user_availability_user_week ON user_availability(user_id, week_start_date);

ALTER TABLE user_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_availability_service_role_all" ON user_availability
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 19. WORKFLOW TEMPLATES
-- =============================================================
CREATE TABLE IF NOT EXISTS workflow_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  created_by  UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_workflow_templates_updated_at
  BEFORE UPDATE ON workflow_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_templates_service_role_all" ON workflow_templates
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 20. WORKFLOW NODES
-- =============================================================
CREATE TABLE IF NOT EXISTS workflow_nodes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  label                TEXT NOT NULL,
  node_type            TEXT NOT NULL
                         CHECK (node_type IN ('start','end','approval','form','department','role','conditional','sync')),
  entity_id            UUID,
  config               JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_workflow_nodes_updated_at
  BEFORE UPDATE ON workflow_nodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_workflow_nodes_template ON workflow_nodes(workflow_template_id);

ALTER TABLE workflow_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_nodes_service_role_all" ON workflow_nodes
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 21. WORKFLOW CONNECTIONS
-- =============================================================
CREATE TABLE IF NOT EXISTS workflow_connections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  from_node_id         UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  to_node_id           UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  condition            TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_connections_template  ON workflow_connections(workflow_template_id);
CREATE INDEX IF NOT EXISTS idx_workflow_connections_from_node ON workflow_connections(from_node_id);

ALTER TABLE workflow_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_connections_service_role_all" ON workflow_connections
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 22. WORKFLOW INSTANCES
-- =============================================================
CREATE TABLE IF NOT EXISTS workflow_instances (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE RESTRICT,
  project_id           UUID REFERENCES projects(id) ON DELETE CASCADE,
  task_id              UUID REFERENCES tasks(id) ON DELETE CASCADE,
  current_node_id      UUID REFERENCES workflow_nodes(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','completed','cancelled')),
  started_snapshot     JSONB,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_workflow_instances_updated_at
  BEFORE UPDATE ON workflow_instances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_workflow_instances_project ON workflow_instances(project_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_status  ON workflow_instances(status);

ALTER TABLE workflow_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_instances_service_role_all" ON workflow_instances
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 23. WORKFLOW HISTORY
-- =============================================================
CREATE TABLE IF NOT EXISTS workflow_history (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  from_node_id         UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE RESTRICT,
  to_node_id           UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE RESTRICT,
  transitioned_by      UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  notes                TEXT,
  transition_type      TEXT NOT NULL DEFAULT 'normal'
                         CHECK (transition_type IN ('normal','skip','rejection')),
  out_of_order         BOOLEAN NOT NULL DEFAULT FALSE,
  form_response_id     UUID,  -- FK added after form_responses
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_history_instance ON workflow_history(workflow_instance_id);
CREATE INDEX IF NOT EXISTS idx_workflow_history_created  ON workflow_history(created_at);

ALTER TABLE workflow_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_history_service_role_all" ON workflow_history
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 24. WORKFLOW ACTIVE STEPS
-- =============================================================
CREATE TABLE IF NOT EXISTS workflow_active_steps (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  node_id              UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  assigned_user_id     UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  branch_id            TEXT NOT NULL DEFAULT 'main',
  status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','completed','skipped')),
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_workflow_active_steps_updated_at
  BEFORE UPDATE ON workflow_active_steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_workflow_active_steps_instance ON workflow_active_steps(workflow_instance_id);

ALTER TABLE workflow_active_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_active_steps_service_role_all" ON workflow_active_steps
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 25. WORKFLOW NODE ASSIGNMENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS workflow_node_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_node_id UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  assigned_user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_node_assignments_node ON workflow_node_assignments(workflow_node_id);

ALTER TABLE workflow_node_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_node_assignments_service_role_all" ON workflow_node_assignments
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 26. WORKFLOW APPROVALS
-- =============================================================
CREATE TABLE IF NOT EXISTS workflow_approvals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  node_id              UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  approver_id          UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','rejected')),
  comments             TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_workflow_approvals_updated_at
  BEFORE UPDATE ON workflow_approvals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE workflow_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_approvals_service_role_all" ON workflow_approvals
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 27. FORM TEMPLATES
-- =============================================================
CREATE TABLE IF NOT EXISTS form_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  fields      JSONB NOT NULL DEFAULT '[]',
  created_by  UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_form_templates_updated_at
  BEFORE UPDATE ON form_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_templates_service_role_all" ON form_templates
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 28. FORM RESPONSES
-- =============================================================
CREATE TABLE IF NOT EXISTS form_responses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_template_id    UUID NOT NULL REFERENCES form_templates(id) ON DELETE RESTRICT,
  workflow_history_id UUID REFERENCES workflow_history(id) ON DELETE SET NULL,
  submitted_by        UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  response_data       JSONB NOT NULL DEFAULT '{}',
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_form_responses_updated_at
  BEFORE UPDATE ON form_responses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_form_responses_template ON form_responses(form_template_id);
CREATE INDEX IF NOT EXISTS idx_form_responses_history  ON form_responses(workflow_history_id);

ALTER TABLE form_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_responses_service_role_all" ON form_responses
  USING (TRUE) WITH CHECK (TRUE);

-- Now add the deferred FK from workflow_history → form_responses
ALTER TABLE workflow_history
  ADD CONSTRAINT fk_workflow_history_form_response
  FOREIGN KEY (form_response_id) REFERENCES form_responses(id) ON DELETE SET NULL;

-- =============================================================
-- 29. CLIENT PORTAL INVITATIONS
-- =============================================================
CREATE TABLE IF NOT EXISTS client_portal_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','accepted','rejected','expired','cancelled')),
  invited_by  UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  invited_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_client_portal_invitations_updated_at
  BEFORE UPDATE ON client_portal_invitations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_client_portal_invitations_account ON client_portal_invitations(account_id);
CREATE INDEX IF NOT EXISTS idx_client_portal_invitations_token   ON client_portal_invitations(token);

ALTER TABLE client_portal_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_portal_invitations_service_role_all" ON client_portal_invitations
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 30. CLIENT FEEDBACK
-- =============================================================
CREATE TABLE IF NOT EXISTS client_feedback (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID REFERENCES projects(id) ON DELETE CASCADE,
  client_user_id          UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  satisfaction_score      INTEGER CHECK (satisfaction_score BETWEEN 1 AND 10),
  what_went_well          TEXT,
  what_needs_improvement  TEXT,
  performance_metrics     JSONB,
  workflow_history_id     UUID REFERENCES workflow_history(id) ON DELETE SET NULL,
  visibility              TEXT NOT NULL DEFAULT 'private'
                            CHECK (visibility IN ('private','internal','public')),
  submitted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_feedback_project ON client_feedback(project_id);

ALTER TABLE client_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_feedback_service_role_all" ON client_feedback
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 31. SETUP TOKENS  (one-time superadmin setup)
-- =============================================================
CREATE TABLE IF NOT EXISTS setup_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  used_by    UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE setup_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "setup_tokens_service_role_all" ON setup_tokens
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 32. ONBOARDING STATE
-- =============================================================
CREATE TABLE IF NOT EXISTS onboarding_state (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
  current_step     TEXT NOT NULL DEFAULT 'welcome',
  completed_steps  TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_onboarding_state_updated_at
  BEFORE UPDATE ON onboarding_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE onboarding_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "onboarding_state_service_role_all" ON onboarding_state
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 33. USER INVITATIONS  (internal team invitations)
-- =============================================================
CREATE TABLE IF NOT EXISTS user_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  invited_by  UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  token       TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','accepted','rejected')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_user_invitations_updated_at
  BEFORE UPDATE ON user_invitations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_user_invitations_token ON user_invitations(token);

ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_invitations_service_role_all" ON user_invitations
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 34. PENDING USER APPROVALS
-- =============================================================
CREATE TABLE IF NOT EXISTS pending_user_approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_pending_user_approvals_updated_at
  BEFORE UPDATE ON pending_user_approvals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE pending_user_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pending_user_approvals_service_role_all" ON pending_user_approvals
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 35. USER DASHBOARD PREFERENCES
-- =============================================================
CREATE TABLE IF NOT EXISTS user_dashboard_preferences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
  widget_config JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_user_dashboard_preferences_updated_at
  BEFORE UPDATE ON user_dashboard_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE user_dashboard_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_dashboard_preferences_service_role_all" ON user_dashboard_preferences
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 36. NEWSLETTERS
-- =============================================================
CREATE TABLE IF NOT EXISTS newsletters (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_by   UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_newsletters_updated_at
  BEFORE UPDATE ON newsletters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_newsletters_published ON newsletters(is_published, published_at DESC);

ALTER TABLE newsletters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "newsletters_service_role_all" ON newsletters
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 37. ESCROWS  (milestone escrow — used by escrow-service)
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

CREATE POLICY "escrows_service_role_all" ON escrows
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- DEFERRED FKs (tables that reference each other)
-- =============================================================

-- project_issues → workflow_history (workflow_history was created after project_issues)
ALTER TABLE project_issues
  ADD CONSTRAINT fk_project_issues_workflow_history
  FOREIGN KEY (workflow_history_id) REFERENCES workflow_history(id) ON DELETE SET NULL;

-- =============================================================
-- AUTO-CREATE USER PROFILE ON SIGNUP
-- Supabase calls this trigger when a new auth.users row is inserted
-- =============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================================
-- SEED: SYSTEM ROLES
-- These are the built-in roles that cannot be edited or deleted.
-- =============================================================
INSERT INTO roles (name, description, is_system_role, hierarchy_level, permissions)
VALUES
  (
    'Superadmin',
    'Full system access. Bypasses all permission checks.',
    TRUE, 100,
    '{}'::jsonb
  ),
  (
    'Client',
    'External client user. Access limited to their account projects.',
    TRUE, 0,
    '{"view_projects": true}'::jsonb
  )
ON CONFLICT DO NOTHING;
