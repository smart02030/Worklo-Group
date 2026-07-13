-- =============================================================
-- SEED: Demo roles (fixed UUIDs) + safe column patches
-- Run after schema.sql, before: npm run seed:users
-- =============================================================

-- 1. Safe patches for DBs that applied an older schema.sql
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS skills TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS has_completed_onboarding BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_date DATE;

-- 2. Insert seed roles with the exact UUIDs create-seed-users.ts expects
INSERT INTO roles (id, name, description, is_system_role, hierarchy_level, permissions) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Superadmin',        'Full system access. Bypasses all permission checks.',               TRUE,  100, '{}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Client',            'External client user. Access limited to their account projects.',  TRUE,  0,   '{"view_projects": true}'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Executive Director','Full analytics and org visibility.',                               FALSE, 90,  '{"view_all_analytics": true, "view_all_projects": true, "view_all_departments": true, "view_all_accounts": true}'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Account Manager',   'Account management views.',                                       FALSE, 60,  '{"manage_accounts": true, "view_all_accounts": true, "manage_projects": true, "view_all_projects": true}'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Project Manager',   'Projects, tasks, and capacity planning.',                         FALSE, 50,  '{"manage_projects": true, "view_projects": true, "view_team_capacity": true, "manage_time": true}'),
  ('77777777-7777-7777-7777-777777777777', 'Admin',             'Workflows, roles, and newsletters.',                              FALSE, 80,  '{"manage_user_roles": true, "manage_workflows": true, "manage_newsletters": true, "manage_users": true}'),
  ('10101010-1010-1010-1010-101010101010', 'Senior Designer',   'Tasks and time tracking.',                                        FALSE, 30,  '{"view_projects": true, "manage_time": true, "edit_own_availability": true}'),
  ('30303030-3030-3030-3030-303030303030', 'Senior Developer',  'Tasks and time tracking.',                                        FALSE, 30,  '{"view_projects": true, "manage_time": true, "edit_own_availability": true}'),
  ('70707070-7070-7070-7070-707070707070', 'Contributor',       'Limited view (contributor access).',                              FALSE, 10,  '{"view_projects": true, "manage_time": true}')
ON CONFLICT (id) DO NOTHING;

-- 3. Fix invalid 'active' status values left from previous seed runs
UPDATE projects SET status = 'in_progress' WHERE status = 'active';
UPDATE accounts  SET status = 'in_progress' WHERE status = 'active';
