 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { createClient } = require('@supabase/supabase-js');
const { logger } = require('@/lib/debug-logger');
// This endpoint resets demo data daily for demo.Worklo.dev
// Runs via Vercel Cron at midnight UTC
// ONLY runs when DEMO_MODE is enabled

const DEMO_PROJECT_URL = process.env.DEMO_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

// Check if demo mode is enabled
function isDemoModeEnabled() {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true' || process.env.DEMO_MODE === 'true';
}
async function GET(_request) {
  // CRITICAL: Only run if demo mode is enabled
  if (!isDemoModeEnabled()) {
    return NextResponse.json(
      {
        error: 'Demo mode is not enabled',
        message: 'This cron job only runs when NEXT_PUBLIC_DEMO_MODE=true or DEMO_MODE=true',
      },
      { status: 403 },
    );
  }

  // Validate CRON_SECRET (required - prevents unauthorized triggering of demo reset)
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error('CRON_SECRET not configured - cron endpoint disabled for security');
    return NextResponse.json(
      { error: 'CRON_SECRET environment variable is required but not configured' },
      { status: 500 },
    );
  }

  const authHeader = _request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized: invalid or missing CRON_SECRET' },
      { status: 401 },
    );
  }

  const serviceRoleKey = process.env.DEMO_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json({ error: 'Service role key not configured' }, { status: 500 });
  }

  if (!DEMO_PROJECT_URL) {
    return NextResponse.json(
      { error: 'Supabase URL not configured (set DEMO_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL)' },
      { status: 500 },
    );
  }

  const supabase = createClient(DEMO_PROJECT_URL, serviceRoleKey);

  try {
    // Step 0: Remove legacy 'Leadership' department (renamed to 'Strategy')
    const removeLegacyDept = `DELETE FROM departments WHERE name = 'Leadership';`;
    await admin.rpc('exec_sql', { query: removeLegacyDept });

    // Ensure all 7 departments exist
    const departmentsUpsert = `
      INSERT INTO departments (name, description) VALUES
        ('Strategy', 'Business strategy, executive direction and company growth'),
        ('Marketing', 'Marketing and communications'),
        ('Design', 'Creative and visual design'),
        ('Development', 'Software development and engineering'),
        ('Operations', 'Operations and project coordination'),
        ('Sales', 'Business development, proposals and client acquisition'),
        ('QA', 'Quality assurance, testing and delivery standards')
      ON CONFLICT (name) DO UPDATE SET
        description = EXCLUDED.description;
    `;
    const { error: deptError } = await admin.rpc('exec_sql', { query: departmentsUpsert });
    if (deptError) logger.error('Departments upsert error', {}, deptError );

    // Get the Operations department ID (it may have been created with a different UUID)
    const { data: opsDept } = await supabase
      .from('departments')
      .select('id')
      .eq('name', 'Operations')
      .single();

    const operationsDeptId = _optionalChain([opsDept, 'optionalAccess', _ => _.id]);

    // Ensure Operations Coordinator role exists (only if we have a valid department)
    if (operationsDeptId) {
      const opsRolePermissions = {
        view_projects: true,
        manage_time: true,
        view_time_entries: true,
        edit_own_availability: true,
        view_departments: true,
        view_newsletters: true,
      };
      const { error: opsRoleError } = await admin.from('roles').upsert(
        {
          name: 'Operations Coordinator',
          department_id: operationsDeptId,
          permissions: opsRolePermissions,
          is_system_role: false,
          hierarchy_level: 50,
          description: 'Operations and logistics',
        },
        { onConflict: 'name' },
      );
      if (opsRoleError)
        logger.error('Operations role upsert error', {}, opsRoleError );
    }

    // Step 1: Clear existing seed data
    const clearQueries = [
      `DELETE FROM workflow_active_steps WHERE workflow_instance_id IN (SELECT id FROM workflow_instances WHERE id::text LIKE 'cccccccc%')`,
      `DELETE FROM workflow_history WHERE workflow_instance_id IN (SELECT id FROM workflow_instances WHERE id::text LIKE 'cccccccc%')`,
      `DELETE FROM workflow_instances WHERE id::text LIKE 'cccccccc%'`,
      `DELETE FROM workflow_connections WHERE id::text LIKE 'bbbbbbbb-cccc%'`,
      `DELETE FROM workflow_nodes WHERE id::text LIKE 'bbbbbbbb-aaaa%'`,
      `DELETE FROM workflow_templates WHERE id::text LIKE 'aaaaaaaa-bbbb%'`,
      `DELETE FROM time_entries WHERE id::text LIKE '66666666%'`,
      `DELETE FROM task_week_allocations WHERE id::text LIKE '99999999%'`,
      `DELETE FROM project_issues WHERE id::text LIKE 'dddddddd%'`,
      `DELETE FROM newsletters WHERE id::text LIKE 'eeeeeeee%'`,
      `DELETE FROM project_updates WHERE id::text LIKE '55555555%'`,
      `DELETE FROM project_assignments WHERE id::text LIKE '44444444%'`,
      `DELETE FROM project_stakeholders WHERE id::text LIKE 'ffffffff%'`,
      `DELETE FROM account_members WHERE id::text LIKE '33333333%'`,
      `DELETE FROM tasks WHERE id::text LIKE '22222222%'`,
      `DELETE FROM projects WHERE id::text LIKE '11111111-2222%'`,
      `DELETE FROM milestones WHERE id::text LIKE '88888888%'`,
      `DELETE FROM user_availability WHERE id::text LIKE '77777777%'`,
    ];

    for (const query of clearQueries) {
      const { error } = await admin.rpc('exec_sql', { query });
      if (error) logger.error('Clear error', {}, error );
    }

    // Step 2: Insert fresh projects with current dates
    const { error: projectsError } = await admin.from('projects').upsert(
      [
        {
          id: '11111111-2222-3333-4444-000000000001',
          name: 'Client Portal Redesign',
          description:
            'Full redesign of the investor-facing client portal — new IA, refreshed UI, and improved document access flows',
          account_id: 'aaaaaaaa-0000-0000-0000-000000000001',
          status: 'in_progress',
          priority: 'high',
          start_date: getRelativeDate(-14),
          end_date: getRelativeDate(30),
          estimated_hours: 240,
          actual_hours: 86,
          created_by: '11111111-1111-1111-1111-000000000004',
        },
        {
          id: '11111111-2222-3333-4444-000000000002',
          name: 'Mobile App Development',
          description:
            'Native iOS and Android app for field workers — job scheduling, time logging, and photo capture',
          account_id: 'aaaaaaaa-0000-0000-0000-000000000001',
          status: 'planning',
          priority: 'medium',
          start_date: getRelativeDate(7),
          end_date: getRelativeDate(120),
          estimated_hours: 480,
          actual_hours: 0,
          created_by: '11111111-1111-1111-1111-000000000004',
        },
        {
          id: '11111111-2222-3333-4444-000000000003',
          name: 'Patient App MVP',
          description:
            'Cross-platform mobile app for appointment booking, secure messaging with care teams, and prescription refill requests',
          account_id: 'aaaaaaaa-0000-0000-0000-000000000002',
          status: 'in_progress',
          priority: 'urgent',
          start_date: getRelativeDate(-10),
          end_date: getRelativeDate(14),
          estimated_hours: 120,
          actual_hours: 68,
          created_by: '11111111-1111-1111-1111-000000000004',
        },
        {
          id: '11111111-2222-3333-4444-000000000004',
          name: 'User Onboarding Flow',
          description:
            'Redesign the new patient onboarding experience — account setup, care team selection, and first appointment booking',
          account_id: 'aaaaaaaa-0000-0000-0000-000000000002',
          status: 'review',
          priority: 'high',
          start_date: getRelativeDate(-21),
          end_date: getRelativeDate(3),
          estimated_hours: 80,
          actual_hours: 72,
          created_by: '11111111-1111-1111-1111-000000000004',
        },
        {
          id: '11111111-2222-3333-4444-000000000005',
          name: 'Brand Identity System',
          description:
            'Complete brand identity for Vanta Health — logo suite, colour system, typography, iconography, and 40-page brand guidelines',
          account_id: 'aaaaaaaa-0000-0000-0000-000000000003',
          status: 'in_progress',
          priority: 'medium',
          start_date: getRelativeDate(-7),
          end_date: getRelativeDate(21),
          estimated_hours: 60,
          actual_hours: 28,
          created_by: '11111111-1111-1111-1111-000000000004',
        },
        {
          id: '11111111-2222-3333-4444-000000000006',
          name: 'E-commerce Platform',
          description:
            'Full e-commerce solution with product catalogue, online ordering, and inventory management integration',
          account_id: 'aaaaaaaa-0000-0000-0000-000000000004',
          status: 'planning',
          priority: 'high',
          start_date: getRelativeDate(14),
          end_date: getRelativeDate(150),
          estimated_hours: 600,
          actual_hours: 0,
          created_by: '11111111-1111-1111-1111-000000000004',
        },
        {
          id: '11111111-2222-3333-4444-000000000007',
          name: 'Spring Collection Lookbook',
          description:
            'Digital lookbook and social media asset pack for the spring/summer collection launch',
          account_id: 'aaaaaaaa-0000-0000-0000-000000000004',
          status: 'complete',
          priority: 'medium',
          start_date: getRelativeDate(-45),
          end_date: getRelativeDate(-7),
          estimated_hours: 40,
          actual_hours: 38,
          created_by: '11111111-1111-1111-1111-000000000004',
        },
        {
          id: '11111111-2222-3333-4444-000000000008',
          name: 'Website Redesign & Online Ordering',
          description:
            'Modern responsive website with integrated online ordering, menu management, and loyalty programme sign-up',
          account_id: 'aaaaaaaa-0000-0000-0000-000000000005',
          status: 'in_progress',
          priority: 'medium',
          start_date: getRelativeDate(-12),
          end_date: getRelativeDate(18),
          estimated_hours: 80,
          actual_hours: 32,
          created_by: '11111111-1111-1111-1111-000000000004',
        },
      ],
      { onConflict: 'id' },
    );

    if (projectsError) {
      logger.error('Projects error', {}, projectsError );
    }

    // Step 3: Insert tasks
    const tasks = generateTasks();
    const { error: tasksError } = await admin.from('tasks').upsert(tasks, { onConflict: 'id' });
    if (tasksError) logger.error('Tasks error', {}, tasksError );

    // Step 4: Insert project assignments
    const assignments = generateAssignments();
    const { error: assignmentsError } = await admin
      .from('project_assignments')
      .upsert(assignments, { onConflict: 'id' });
    if (assignmentsError)
      logger.error('Assignments error', {}, assignmentsError );

    // Step 5: Insert account members
    const members = generateAccountMembers();
    const { error: membersError } = await admin
      .from('account_members')
      .upsert(members, { onConflict: 'id' });
    if (membersError) logger.error('Members error', {}, membersError );

    // Step 6: Insert time entries
    const timeEntries = generateTimeEntries();
    const { error: timeError } = await admin
      .from('time_entries')
      .upsert(timeEntries, { onConflict: 'id' });
    if (timeError) logger.error('Time entries error', {}, timeError );

    // Step 7: Insert project updates
    const updates = generateProjectUpdates();
    const { error: updatesError } = await admin
      .from('project_updates')
      .upsert(updates, { onConflict: 'id' });
    if (updatesError) logger.error('Updates error', {}, updatesError );

    // Step 8: Insert milestones
    const milestones = generateMilestones();
    const { error: milestonesError } = await admin
      .from('milestones')
      .upsert(milestones, { onConflict: 'id' });
    if (milestonesError) logger.error('Milestones error', {}, milestonesError );

    // Step 9: Insert user availability
    const availability = generateUserAvailability();
    const { error: availabilityError } = await admin
      .from('user_availability')
      .upsert(availability, { onConflict: 'id' });
    if (availabilityError)
      logger.error('Availability error', {}, availabilityError );

    // Step 10: Insert workflow templates
    const workflowTemplates = generateWorkflowTemplates();
    const { error: templatesError } = await admin
      .from('workflow_templates')
      .upsert(workflowTemplates, { onConflict: 'id' });
    if (templatesError)
      logger.error('Workflow templates error', {}, templatesError );

    // Step 11: Insert workflow nodes
    const workflowNodes = generateWorkflowNodes();
    const { error: nodesError } = await admin
      .from('workflow_nodes')
      .upsert(workflowNodes, { onConflict: 'id' });
    if (nodesError) logger.error('Workflow nodes error', {}, nodesError );

    // Step 12: Insert workflow connections
    const workflowConnections = generateWorkflowConnections();
    const { error: connectionsError } = await admin
      .from('workflow_connections')
      .upsert(workflowConnections, { onConflict: 'id' });
    if (connectionsError)
      logger.error('Workflow connections error', {}, connectionsError );

    // Step 13: Insert workflow instances
    const workflowInstances = generateWorkflowInstances();
    const { error: instancesError } = await admin
      .from('workflow_instances')
      .upsert(workflowInstances, { onConflict: 'id' });
    if (instancesError)
      logger.error('Workflow instances error', {}, instancesError );

    // Step 14: Insert newsletters
    const newsletters = generateNewsletters();
    const { error: newslettersError } = await admin
      .from('newsletters')
      .upsert(newsletters, { onConflict: 'id' });
    if (newslettersError)
      logger.error('Newsletters error', {}, newslettersError );

    // Step 15: Insert project issues
    const projectIssues = generateProjectIssues();
    const { error: issuesError } = await admin
      .from('project_issues')
      .upsert(projectIssues, { onConflict: 'id' });
    if (issuesError) logger.error('Project issues error', {}, issuesError );

    // Step 16: Insert task week allocations
    const taskAllocations = generateTaskWeekAllocations();
    const { error: allocationsError } = await admin
      .from('task_week_allocations')
      .upsert(taskAllocations, { onConflict: 'id' });
    if (allocationsError)
      logger.error('Task allocations error', {}, allocationsError );

    // Step 17: Insert project stakeholders
    const stakeholders = generateProjectStakeholders();
    const { error: stakeholdersError } = await admin
      .from('project_stakeholders')
      .upsert(stakeholders, { onConflict: 'id' });
    if (stakeholdersError)
      logger.error('Stakeholders error', {}, stakeholdersError );

    // Step 18: Update role permissions for demo (all internal users get manage_time, edit_own_availability, view_newsletters, view_issues)
    // SAFETY NOTE: exec_sql is used here for bulk JSONB merge (permissions || jsonb). This is safe
    // because all values are hardcoded strings with no user input interpolation.
    const rolePermissionsUpdate = `
      UPDATE roles SET permissions = permissions ||
        '{"manage_time": true, "edit_own_availability": true, "view_newsletters": true, "view_departments": true, "view_issues": true}'::jsonb
      WHERE name IN ('Executive Director', 'Account Manager', 'Project Manager', 'Senior Designer', 'Senior Developer', 'Junior Designer', 'Junior Developer', 'Admin');
    `;
    const { error: permError } = await admin.rpc('exec_sql', { query: rolePermissionsUpdate });
    if (permError) logger.error('Role permissions update error', {}, permError );

    // Step 19: Add leadership permissions (manage_issues for managers and above)
    // SAFETY NOTE: exec_sql is used here for bulk JSONB merge. Safe because all values are hardcoded with no interpolation.
    const leadershipPermissionsUpdate = `
      UPDATE roles SET permissions = permissions ||
        '{"manage_issues": true}'::jsonb
      WHERE name IN ('Executive Director', 'Account Manager', 'Project Manager', 'Admin');
    `;
    const { error: leadershipPermError } = await admin.rpc('exec_sql', {
      query: leadershipPermissionsUpdate,
    });
    if (leadershipPermError)
      logger.error(
        'Leadership permissions update error',
        {},
        leadershipPermError ,
      );

    // Step 20: Add admin-specific permissions to Admin role
    // SAFETY NOTE: exec_sql is used here for bulk JSONB merge. Safe because all values are hardcoded with no interpolation.
    const adminPermissionsUpdate = `
      UPDATE roles SET permissions = permissions ||
        '{"manage_departments": true, "manage_user_roles": true, "manage_workflows": true, "manage_accounts": true, "view_all_accounts": true, "view_all_projects": true, "manage_projects": true, "view_all_analytics": true, "view_all_capacity": true, "view_all_time_entries": true, "manage_all_workflows": true, "execute_any_workflow": true, "view_all_updates": true, "view_all_department_analytics": true, "view_all_account_analytics": true, "manage_users_in_accounts": true}'::jsonb
      WHERE name = 'Admin';
    `;
    const { error: adminPermError } = await admin.rpc('exec_sql', {
      query: adminPermissionsUpdate,
    });
    if (adminPermError)
      logger.error('Admin permissions update error', {}, adminPermError );

    return NextResponse.json({
      success: true,
      message: 'Demo data reset successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error resetting demo data', {}, error );
    return NextResponse.json(
      {
        error: 'Failed to reset demo data',
      },
      { status: 500 },
    );
  }
}

// Helper functions
function getRelativeDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

function getWeekStart(daysOffset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date.toISOString().split('T')[0];
}

function generateTasks() {
  return [
    {
      id: '22222222-3333-4444-5555-000000000001',
      name: 'User Research & Stakeholder Interviews',
      description:
        'Conduct interviews with Meridian advisors and clients to map pain points in the current portal',
      project_id: '11111111-2222-3333-4444-000000000001',
      status: 'done',
      priority: 'high',
      start_date: getRelativeDate(-14),
      due_date: getRelativeDate(-7),
      estimated_hours: 16,
      actual_hours: 16,
      assigned_to: '11111111-1111-1111-1111-000000000005',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '22222222-3333-4444-5555-000000000002',
      name: 'Portal Wireframes & Component Library',
      description: 'Create wireframes for all portal screens and build the Figma component library',
      project_id: '11111111-2222-3333-4444-000000000001',
      status: 'done',
      priority: 'high',
      start_date: getRelativeDate(-7),
      due_date: getRelativeDate(-2),
      estimated_hours: 24,
      actual_hours: 26,
      assigned_to: '11111111-1111-1111-1111-000000000005',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '22222222-3333-4444-5555-000000000003',
      name: 'Portal Frontend Build',
      description:
        'Implement React components from approved designs — dashboard, document vault, and account settings',
      project_id: '11111111-2222-3333-4444-000000000001',
      status: 'in_progress',
      priority: 'high',
      start_date: getRelativeDate(-2),
      due_date: getRelativeDate(14),
      estimated_hours: 80,
      actual_hours: 24,
      assigned_to: '11111111-1111-1111-1111-000000000006',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '22222222-3333-4444-5555-000000000004',
      name: 'Document Vault API Integration',
      description: 'Connect portal to Meridian document management system via REST API',
      project_id: '11111111-2222-3333-4444-000000000001',
      status: 'in_progress',
      priority: 'medium',
      start_date: getRelativeDate(-1),
      due_date: getRelativeDate(12),
      estimated_hours: 60,
      actual_hours: 20,
      assigned_to: '11111111-1111-1111-1111-000000000006',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '22222222-3333-4444-5555-000000000005',
      name: 'QA & Cross-browser Testing',
      description: 'Comprehensive testing across Chrome, Safari, Firefox, and mobile browsers',
      project_id: '11111111-2222-3333-4444-000000000001',
      status: 'todo',
      priority: 'medium',
      start_date: getRelativeDate(14),
      due_date: getRelativeDate(21),
      estimated_hours: 24,
      actual_hours: 0,
      assigned_to: null,
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '22222222-3333-4444-5555-000000000006',
      name: 'App Homepage & Onboarding Screens',
      description: 'Design the patient app home screen, onboarding flow, and care team selection',
      project_id: '11111111-2222-3333-4444-000000000003',
      status: 'done',
      priority: 'urgent',
      start_date: getRelativeDate(-10),
      due_date: getRelativeDate(-5),
      estimated_hours: 16,
      actual_hours: 18,
      assigned_to: '11111111-1111-1111-1111-000000000005',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '22222222-3333-4444-5555-000000000007',
      name: 'Appointment Booking UI',
      description:
        'Calendar-based booking flow with provider availability and appointment type selection',
      project_id: '11111111-2222-3333-4444-000000000003',
      status: 'done',
      priority: 'high',
      start_date: getRelativeDate(-5),
      due_date: getRelativeDate(-1),
      estimated_hours: 20,
      actual_hours: 22,
      assigned_to: '11111111-1111-1111-1111-000000000005',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '22222222-3333-4444-5555-000000000008',
      name: 'React Native Implementation',
      description: 'Build cross-platform app from approved designs — iOS and Android',
      project_id: '11111111-2222-3333-4444-000000000003',
      status: 'in_progress',
      priority: 'urgent',
      start_date: getRelativeDate(-3),
      due_date: getRelativeDate(5),
      estimated_hours: 40,
      actual_hours: 28,
      assigned_to: '11111111-1111-1111-1111-000000000006',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '22222222-3333-4444-5555-000000000009',
      name: 'Push Notifications & Reminders',
      description: 'Implement appointment reminders and prescription refill notifications',
      project_id: '11111111-2222-3333-4444-000000000003',
      status: 'todo',
      priority: 'medium',
      start_date: getRelativeDate(5),
      due_date: getRelativeDate(8),
      estimated_hours: 8,
      actual_hours: 0,
      assigned_to: '11111111-1111-1111-1111-000000000006',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '22222222-3333-4444-5555-000000000010',
      name: 'Logo Suite Design',
      description:
        'Primary, secondary, and icon-only logo variants in full colour, reversed, and monochrome',
      project_id: '11111111-2222-3333-4444-000000000005',
      status: 'done',
      priority: 'high',
      start_date: getRelativeDate(-7),
      due_date: getRelativeDate(-3),
      estimated_hours: 16,
      actual_hours: 14,
      assigned_to: '11111111-1111-1111-1111-000000000005',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '22222222-3333-4444-5555-000000000011',
      name: 'Colour Palette & Typography System',
      description: 'Define primary and secondary colour palettes, type scale, and spacing system',
      project_id: '11111111-2222-3333-4444-000000000005',
      status: 'in_progress',
      priority: 'medium',
      start_date: getRelativeDate(-2),
      due_date: getRelativeDate(3),
      estimated_hours: 8,
      actual_hours: 6,
      assigned_to: '11111111-1111-1111-1111-000000000005',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '22222222-3333-4444-5555-000000000012',
      name: 'Menu Page & Gallery Design',
      description: 'Design interactive menu page with category filters and photo gallery',
      project_id: '11111111-2222-3333-4444-000000000008',
      status: 'done',
      priority: 'high',
      start_date: getRelativeDate(-12),
      due_date: getRelativeDate(-6),
      estimated_hours: 16,
      actual_hours: 14,
      assigned_to: '11111111-1111-1111-1111-000000000005',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '22222222-3333-4444-5555-000000000013',
      name: 'Online Ordering & Stripe Integration',
      description:
        'Build cart, checkout, and Stripe payment processing with order confirmation emails',
      project_id: '11111111-2222-3333-4444-000000000008',
      status: 'in_progress',
      priority: 'high',
      start_date: getRelativeDate(-2),
      due_date: getRelativeDate(10),
      estimated_hours: 40,
      actual_hours: 8,
      assigned_to: '11111111-1111-1111-1111-000000000006',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
  ];
}

function generateAssignments() {
  return [
    // Existing assignments
    {
      id: '44444444-5555-6666-7777-000000000001',
      project_id: '11111111-2222-3333-4444-000000000001',
      user_id: '11111111-1111-1111-1111-000000000004',
      role_in_project: 'Project Manager',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      id: '44444444-5555-6666-7777-000000000002',
      project_id: '11111111-2222-3333-4444-000000000001',
      user_id: '11111111-1111-1111-1111-000000000005',
      role_in_project: 'Lead Designer',
      assigned_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '44444444-5555-6666-7777-000000000003',
      project_id: '11111111-2222-3333-4444-000000000001',
      user_id: '11111111-1111-1111-1111-000000000006',
      role_in_project: 'Lead Developer',
      assigned_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '44444444-5555-6666-7777-000000000004',
      project_id: '11111111-2222-3333-4444-000000000003',
      user_id: '11111111-1111-1111-1111-000000000004',
      role_in_project: 'Project Manager',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      id: '44444444-5555-6666-7777-000000000005',
      project_id: '11111111-2222-3333-4444-000000000003',
      user_id: '11111111-1111-1111-1111-000000000005',
      role_in_project: 'Designer',
      assigned_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '44444444-5555-6666-7777-000000000006',
      project_id: '11111111-2222-3333-4444-000000000003',
      user_id: '11111111-1111-1111-1111-000000000006',
      role_in_project: 'Developer',
      assigned_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '44444444-5555-6666-7777-000000000007',
      project_id: '11111111-2222-3333-4444-000000000003',
      user_id: '11111111-1111-1111-1111-000000000008',
      role_in_project: 'Client Stakeholder',
      assigned_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '44444444-5555-6666-7777-000000000008',
      project_id: '11111111-2222-3333-4444-000000000005',
      user_id: '11111111-1111-1111-1111-000000000004',
      role_in_project: 'Project Manager',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      id: '44444444-5555-6666-7777-000000000009',
      project_id: '11111111-2222-3333-4444-000000000005',
      user_id: '11111111-1111-1111-1111-000000000005',
      role_in_project: 'Brand Designer',
      assigned_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '44444444-5555-6666-7777-000000000010',
      project_id: '11111111-2222-3333-4444-000000000008',
      user_id: '11111111-1111-1111-1111-000000000004',
      role_in_project: 'Project Manager',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      id: '44444444-5555-6666-7777-000000000011',
      project_id: '11111111-2222-3333-4444-000000000008',
      user_id: '11111111-1111-1111-1111-000000000005',
      role_in_project: 'Designer',
      assigned_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '44444444-5555-6666-7777-000000000012',
      project_id: '11111111-2222-3333-4444-000000000008',
      user_id: '11111111-1111-1111-1111-000000000006',
      role_in_project: 'Developer',
      assigned_by: '11111111-1111-1111-1111-000000000004',
    },
    // Alex Executive as Executive Sponsor on key projects
    {
      id: '44444444-5555-6666-7777-000000000013',
      project_id: '11111111-2222-3333-4444-000000000001',
      user_id: '11111111-1111-1111-1111-000000000002',
      role_in_project: 'Executive Sponsor',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      id: '44444444-5555-6666-7777-000000000014',
      project_id: '11111111-2222-3333-4444-000000000003',
      user_id: '11111111-1111-1111-1111-000000000002',
      role_in_project: 'Executive Sponsor',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      id: '44444444-5555-6666-7777-000000000015',
      project_id: '11111111-2222-3333-4444-000000000005',
      user_id: '11111111-1111-1111-1111-000000000002',
      role_in_project: 'Executive Sponsor',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    // Morgan Manager on more projects
    {
      id: '44444444-5555-6666-7777-000000000016',
      project_id: '11111111-2222-3333-4444-000000000002',
      user_id: '11111111-1111-1111-1111-000000000004',
      role_in_project: 'Project Manager',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      id: '44444444-5555-6666-7777-000000000017',
      project_id: '11111111-2222-3333-4444-000000000002',
      user_id: '11111111-1111-1111-1111-000000000006',
      role_in_project: 'Lead Developer',
      assigned_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '44444444-5555-6666-7777-000000000018',
      project_id: '11111111-2222-3333-4444-000000000006',
      user_id: '11111111-1111-1111-1111-000000000003',
      role_in_project: 'Account Manager',
      assigned_by: '11111111-1111-1111-1111-000000000002',
    },
    {
      id: '44444444-5555-6666-7777-000000000019',
      project_id: '11111111-2222-3333-4444-000000000004',
      user_id: '11111111-1111-1111-1111-000000000004',
      role_in_project: 'Project Manager',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      id: '44444444-5555-6666-7777-000000000020',
      project_id: '11111111-2222-3333-4444-000000000004',
      user_id: '11111111-1111-1111-1111-000000000005',
      role_in_project: 'UX Designer',
      assigned_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: '44444444-5555-6666-7777-000000000021',
      project_id: '11111111-2222-3333-4444-000000000004',
      user_id: '11111111-1111-1111-1111-000000000006',
      role_in_project: 'Developer',
      assigned_by: '11111111-1111-1111-1111-000000000004',
    },
    // Andy Admin on all projects (admin access)
    {
      id: '44444444-5555-6666-7777-000000000022',
      project_id: '11111111-2222-3333-4444-000000000001',
      user_id: '11111111-1111-1111-1111-000000000009',
      role_in_project: 'Admin',
      assigned_by: '11111111-1111-1111-1111-000000000002',
    },
    {
      id: '44444444-5555-6666-7777-000000000023',
      project_id: '11111111-2222-3333-4444-000000000002',
      user_id: '11111111-1111-1111-1111-000000000009',
      role_in_project: 'Admin',
      assigned_by: '11111111-1111-1111-1111-000000000002',
    },
    {
      id: '44444444-5555-6666-7777-000000000024',
      project_id: '11111111-2222-3333-4444-000000000003',
      user_id: '11111111-1111-1111-1111-000000000009',
      role_in_project: 'Admin',
      assigned_by: '11111111-1111-1111-1111-000000000002',
    },
    {
      id: '44444444-5555-6666-7777-000000000025',
      project_id: '11111111-2222-3333-4444-000000000004',
      user_id: '11111111-1111-1111-1111-000000000009',
      role_in_project: 'Admin',
      assigned_by: '11111111-1111-1111-1111-000000000002',
    },
    {
      id: '44444444-5555-6666-7777-000000000026',
      project_id: '11111111-2222-3333-4444-000000000005',
      user_id: '11111111-1111-1111-1111-000000000009',
      role_in_project: 'Admin',
      assigned_by: '11111111-1111-1111-1111-000000000002',
    },
    {
      id: '44444444-5555-6666-7777-000000000027',
      project_id: '11111111-2222-3333-4444-000000000006',
      user_id: '11111111-1111-1111-1111-000000000009',
      role_in_project: 'Admin',
      assigned_by: '11111111-1111-1111-1111-000000000002',
    },
    {
      id: '44444444-5555-6666-7777-000000000028',
      project_id: '11111111-2222-3333-4444-000000000007',
      user_id: '11111111-1111-1111-1111-000000000009',
      role_in_project: 'Admin',
      assigned_by: '11111111-1111-1111-1111-000000000002',
    },
    {
      id: '44444444-5555-6666-7777-000000000029',
      project_id: '11111111-2222-3333-4444-000000000008',
      user_id: '11111111-1111-1111-1111-000000000009',
      role_in_project: 'Admin',
      assigned_by: '11111111-1111-1111-1111-000000000002',
    },
  ];
}

function generateAccountMembers() {
  return [
    {
      id: '33333333-4444-5555-6666-000000000001',
      user_id: '11111111-1111-1111-1111-000000000003',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    },
    {
      id: '33333333-4444-5555-6666-000000000002',
      user_id: '11111111-1111-1111-1111-000000000003',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000002',
    },
    {
      id: '33333333-4444-5555-6666-000000000003',
      user_id: '11111111-1111-1111-1111-000000000004',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    },
    {
      id: '33333333-4444-5555-6666-000000000004',
      user_id: '11111111-1111-1111-1111-000000000004',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000002',
    },
    {
      id: '33333333-4444-5555-6666-000000000005',
      user_id: '11111111-1111-1111-1111-000000000004',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000003',
    },
    {
      id: '33333333-4444-5555-6666-000000000006',
      user_id: '11111111-1111-1111-1111-000000000004',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000005',
    },
    {
      id: '33333333-4444-5555-6666-000000000007',
      user_id: '11111111-1111-1111-1111-000000000005',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    },
    {
      id: '33333333-4444-5555-6666-000000000008',
      user_id: '11111111-1111-1111-1111-000000000005',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000002',
    },
    {
      id: '33333333-4444-5555-6666-000000000009',
      user_id: '11111111-1111-1111-1111-000000000005',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000003',
    },
    {
      id: '33333333-4444-5555-6666-000000000010',
      user_id: '11111111-1111-1111-1111-000000000005',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000005',
    },
    {
      id: '33333333-4444-5555-6666-000000000011',
      user_id: '11111111-1111-1111-1111-000000000006',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    },
    {
      id: '33333333-4444-5555-6666-000000000012',
      user_id: '11111111-1111-1111-1111-000000000006',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000002',
    },
    {
      id: '33333333-4444-5555-6666-000000000013',
      user_id: '11111111-1111-1111-1111-000000000006',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000005',
    },
    {
      id: '33333333-4444-5555-6666-000000000014',
      user_id: '11111111-1111-1111-1111-000000000008',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000002',
    },
    {
      id: '33333333-4444-5555-6666-000000000015',
      user_id: '11111111-1111-1111-1111-000000000002',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    },
    {
      id: '33333333-4444-5555-6666-000000000016',
      user_id: '11111111-1111-1111-1111-000000000002',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000002',
    },
    {
      id: '33333333-4444-5555-6666-000000000017',
      user_id: '11111111-1111-1111-1111-000000000002',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000003',
    },
    {
      id: '33333333-4444-5555-6666-000000000018',
      user_id: '11111111-1111-1111-1111-000000000002',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000004',
    },
    {
      id: '33333333-4444-5555-6666-000000000019',
      user_id: '11111111-1111-1111-1111-000000000002',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000005',
    },
    // Andy Admin on all accounts
    {
      id: '33333333-4444-5555-6666-000000000020',
      user_id: '11111111-1111-1111-1111-000000000009',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    },
    {
      id: '33333333-4444-5555-6666-000000000021',
      user_id: '11111111-1111-1111-1111-000000000009',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000002',
    },
    {
      id: '33333333-4444-5555-6666-000000000022',
      user_id: '11111111-1111-1111-1111-000000000009',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000003',
    },
    {
      id: '33333333-4444-5555-6666-000000000023',
      user_id: '11111111-1111-1111-1111-000000000009',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000004',
    },
    {
      id: '33333333-4444-5555-6666-000000000024',
      user_id: '11111111-1111-1111-1111-000000000009',
      account_id: 'aaaaaaaa-0000-0000-0000-000000000005',
    },
  ];
}

function generateTimeEntries() {
  return [
    // Dana Designer entries
    {
      id: '66666666-7777-8888-9999-000000000001',
      task_id: '22222222-3333-4444-5555-000000000011',
      user_id: '11111111-1111-1111-1111-000000000005',
      project_id: '11111111-2222-3333-4444-000000000005',
      hours_logged: 4,
      entry_date: getRelativeDate(0),
      week_start_date: getWeekStart(),
      description: 'Colour palette and typography iterations',
    },
    {
      id: '66666666-7777-8888-9999-000000000002',
      task_id: '22222222-3333-4444-5555-000000000003',
      user_id: '11111111-1111-1111-1111-000000000005',
      project_id: '11111111-2222-3333-4444-000000000001',
      hours_logged: 3,
      entry_date: getRelativeDate(0),
      week_start_date: getWeekStart(),
      description: 'Portal design review with Meridian stakeholders',
    },
    {
      id: '66666666-7777-8888-9999-000000000006',
      task_id: '22222222-3333-4444-5555-000000000007',
      user_id: '11111111-1111-1111-1111-000000000005',
      project_id: '11111111-2222-3333-4444-000000000003',
      hours_logged: 6,
      entry_date: getRelativeDate(-1),
      week_start_date: getWeekStart(),
      description: 'Appointment booking UI refinements',
    },
    {
      id: '66666666-7777-8888-9999-000000000007',
      task_id: '22222222-3333-4444-5555-000000000002',
      user_id: '11111111-1111-1111-1111-000000000005',
      project_id: '11111111-2222-3333-4444-000000000001',
      hours_logged: 8,
      entry_date: getRelativeDate(-2),
      week_start_date: getWeekStart(),
      description: 'Portal component library and design tokens',
    },
    {
      id: '66666666-7777-8888-9999-000000000010',
      task_id: '22222222-3333-4444-5555-000000000010',
      user_id: '11111111-1111-1111-1111-000000000005',
      project_id: '11111111-2222-3333-4444-000000000005',
      hours_logged: 8,
      entry_date: getRelativeDate(-4),
      week_start_date: getWeekStart(-7),
      description: 'Vanta Health logo suite concepts',
    },
    {
      id: '66666666-7777-8888-9999-000000000011',
      task_id: '22222222-3333-4444-5555-000000000012',
      user_id: '11111111-1111-1111-1111-000000000005',
      project_id: '11111111-2222-3333-4444-000000000008',
      hours_logged: 6,
      entry_date: getRelativeDate(-5),
      week_start_date: getWeekStart(-7),
      description: 'Harlow menu page and gallery design',
    },
    // Dev Developer entries
    {
      id: '66666666-7777-8888-9999-000000000003',
      task_id: '22222222-3333-4444-5555-000000000003',
      user_id: '11111111-1111-1111-1111-000000000006',
      project_id: '11111111-2222-3333-4444-000000000001',
      hours_logged: 8,
      entry_date: getRelativeDate(0),
      week_start_date: getWeekStart(),
      description: 'Portal dashboard React components',
    },
    {
      id: '66666666-7777-8888-9999-000000000004',
      task_id: '22222222-3333-4444-5555-000000000004',
      user_id: '11111111-1111-1111-1111-000000000006',
      project_id: '11111111-2222-3333-4444-000000000001',
      hours_logged: 6,
      entry_date: getRelativeDate(0),
      week_start_date: getWeekStart(),
      description: 'Document vault API integration',
    },
    {
      id: '66666666-7777-8888-9999-000000000005',
      task_id: '22222222-3333-4444-5555-000000000008',
      user_id: '11111111-1111-1111-1111-000000000006',
      project_id: '11111111-2222-3333-4444-000000000003',
      hours_logged: 8,
      entry_date: getRelativeDate(-1),
      week_start_date: getWeekStart(),
      description: 'React Native cross-platform implementation',
    },
    {
      id: '66666666-7777-8888-9999-000000000008',
      task_id: '22222222-3333-4444-5555-000000000003',
      user_id: '11111111-1111-1111-1111-000000000006',
      project_id: '11111111-2222-3333-4444-000000000001',
      hours_logged: 8,
      entry_date: getRelativeDate(-2),
      week_start_date: getWeekStart(),
      description: 'Document vault UI and search functionality',
    },
    {
      id: '66666666-7777-8888-9999-000000000009',
      task_id: '22222222-3333-4444-5555-000000000008',
      user_id: '11111111-1111-1111-1111-000000000006',
      project_id: '11111111-2222-3333-4444-000000000003',
      hours_logged: 6,
      entry_date: getRelativeDate(-3),
      week_start_date: getWeekStart(),
      description: 'Android layout fixes and breakpoints',
    },
    {
      id: '66666666-7777-8888-9999-000000000012',
      task_id: '22222222-3333-4444-5555-000000000013',
      user_id: '11111111-1111-1111-1111-000000000006',
      project_id: '11111111-2222-3333-4444-000000000008',
      hours_logged: 4,
      entry_date: getRelativeDate(-5),
      week_start_date: getWeekStart(-7),
      description: 'Stripe payment integration setup',
    },
    // Alex Executive entries
    {
      id: '66666666-7777-8888-9999-000000000013',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000002',
      project_id: '11111111-2222-3333-4444-000000000001',
      hours_logged: 2,
      entry_date: getRelativeDate(0),
      week_start_date: getWeekStart(),
      description: 'Meridian portal QBR preparation',
    },
    {
      id: '66666666-7777-8888-9999-000000000014',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000002',
      project_id: '11111111-2222-3333-4444-000000000003',
      hours_logged: 1.5,
      entry_date: getRelativeDate(-1),
      week_start_date: getWeekStart(),
      description: 'Vanta Health budget sign-off call',
    },
    {
      id: '66666666-7777-8888-9999-000000000015',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000002',
      project_id: '11111111-2222-3333-4444-000000000005',
      hours_logged: 1,
      entry_date: getRelativeDate(-2),
      week_start_date: getWeekStart(),
      description: 'Brand identity executive review',
    },
    {
      id: '66666666-7777-8888-9999-000000000016',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000002',
      project_id: '11111111-2222-3333-4444-000000000001',
      hours_logged: 2,
      entry_date: getRelativeDate(-4),
      week_start_date: getWeekStart(-7),
      description: 'Meridian quarterly account review',
    },
    {
      id: '66666666-7777-8888-9999-000000000017',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000002',
      project_id: '11111111-2222-3333-4444-000000000003',
      hours_logged: 1,
      entry_date: getRelativeDate(-5),
      week_start_date: getWeekStart(-7),
      description: 'Vanta Health scope change approval',
    },
    // Morgan Manager entries
    {
      id: '66666666-7777-8888-9999-000000000018',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000003',
      project_id: '11111111-2222-3333-4444-000000000006',
      hours_logged: 3,
      entry_date: getRelativeDate(0),
      week_start_date: getWeekStart(),
      description: 'E-commerce platform kickoff planning',
    },
    {
      id: '66666666-7777-8888-9999-000000000019',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000003',
      project_id: '11111111-2222-3333-4444-000000000006',
      hours_logged: 2,
      entry_date: getRelativeDate(-1),
      week_start_date: getWeekStart(),
      description: 'E-commerce requirements and scope review',
    },
    {
      id: '66666666-7777-8888-9999-000000000020',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000003',
      project_id: '11111111-2222-3333-4444-000000000001',
      hours_logged: 1.5,
      entry_date: getRelativeDate(-2),
      week_start_date: getWeekStart(),
      description: 'Meridian account health check-in',
    },
    {
      id: '66666666-7777-8888-9999-000000000021',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000003',
      project_id: '11111111-2222-3333-4444-000000000003',
      hours_logged: 2,
      entry_date: getRelativeDate(-4),
      week_start_date: getWeekStart(-7),
      description: 'Vanta Health client meeting and onboarding',
    },
    // Pat Project Manager entries
    {
      id: '66666666-7777-8888-9999-000000000022',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000004',
      project_id: '11111111-2222-3333-4444-000000000001',
      hours_logged: 4,
      entry_date: getRelativeDate(0),
      week_start_date: getWeekStart(),
      description: 'Portal redesign sprint 3 planning',
    },
    {
      id: '66666666-7777-8888-9999-000000000023',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000004',
      project_id: '11111111-2222-3333-4444-000000000003',
      hours_logged: 3,
      entry_date: getRelativeDate(-1),
      week_start_date: getWeekStart(),
      description: 'Patient app MVP coordination',
    },
    {
      id: '66666666-7777-8888-9999-000000000024',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000004',
      project_id: '11111111-2222-3333-4444-000000000005',
      hours_logged: 2,
      entry_date: getRelativeDate(-2),
      week_start_date: getWeekStart(),
      description: 'Brand identity client review session',
    },
    {
      id: '66666666-7777-8888-9999-000000000025',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000004',
      project_id: '11111111-2222-3333-4444-000000000008',
      hours_logged: 2.5,
      entry_date: getRelativeDate(-3),
      week_start_date: getWeekStart(),
      description: 'Harlow website progress review',
    },
    {
      id: '66666666-7777-8888-9999-000000000026',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000004',
      project_id: '11111111-2222-3333-4444-000000000004',
      hours_logged: 3,
      entry_date: getRelativeDate(-4),
      week_start_date: getWeekStart(-7),
      description: 'Onboarding flow UAT coordination with Vanta Health',
    },
    {
      id: '66666666-7777-8888-9999-000000000027',
      task_id: '22222222-3333-4444-5555-000000000001',
      user_id: '11111111-1111-1111-1111-000000000004',
      project_id: '11111111-2222-3333-4444-000000000001',
      hours_logged: 3,
      entry_date: getRelativeDate(-5),
      week_start_date: getWeekStart(-7),
      description: 'Portal redesign sprint retrospective',
    },
    // Andy Admin entries
    {
      id: '66666666-7777-8888-9999-000000000028',
      task_id: '22222222-3333-4444-5555-000000000005',
      user_id: '11111111-1111-1111-1111-000000000009',
      project_id: '11111111-2222-3333-4444-000000000001',
      hours_logged: 3,
      entry_date: getRelativeDate(0),
      week_start_date: getWeekStart(),
      description: 'Portal workflow configuration and role setup',
    },
    {
      id: '66666666-7777-8888-9999-000000000029',
      task_id: '22222222-3333-4444-5555-000000000005',
      user_id: '11111111-1111-1111-1111-000000000009',
      project_id: '11111111-2222-3333-4444-000000000003',
      hours_logged: 2,
      entry_date: getRelativeDate(0),
      week_start_date: getWeekStart(),
      description: 'Vanta Health access management',
    },
    {
      id: '66666666-7777-8888-9999-000000000030',
      task_id: '22222222-3333-4444-5555-000000000005',
      user_id: '11111111-1111-1111-1111-000000000009',
      project_id: '11111111-2222-3333-4444-000000000002',
      hours_logged: 1.5,
      entry_date: getRelativeDate(-1),
      week_start_date: getWeekStart(),
      description: 'Mobile app project environment setup',
    },
    {
      id: '66666666-7777-8888-9999-000000000031',
      task_id: '22222222-3333-4444-5555-000000000005',
      user_id: '11111111-1111-1111-1111-000000000009',
      project_id: '11111111-2222-3333-4444-000000000005',
      hours_logged: 2,
      entry_date: getRelativeDate(-1),
      week_start_date: getWeekStart(),
      description: 'Brand identity workflow configuration',
    },
    {
      id: '66666666-7777-8888-9999-000000000032',
      task_id: '22222222-3333-4444-5555-000000000005',
      user_id: '11111111-1111-1111-1111-000000000009',
      project_id: '11111111-2222-3333-4444-000000000006',
      hours_logged: 3,
      entry_date: getRelativeDate(-2),
      week_start_date: getWeekStart(),
      description: 'E-commerce platform initial project setup',
    },
    {
      id: '66666666-7777-8888-9999-000000000033',
      task_id: '22222222-3333-4444-5555-000000000005',
      user_id: '11111111-1111-1111-1111-000000000009',
      project_id: '11111111-2222-3333-4444-000000000008',
      hours_logged: 1.5,
      entry_date: getRelativeDate(-3),
      week_start_date: getWeekStart(),
      description: 'Harlow permissions and user access audit',
    },
    {
      id: '66666666-7777-8888-9999-000000000034',
      task_id: '22222222-3333-4444-5555-000000000005',
      user_id: '11111111-1111-1111-1111-000000000009',
      project_id: '11111111-2222-3333-4444-000000000001',
      hours_logged: 2,
      entry_date: getRelativeDate(-4),
      week_start_date: getWeekStart(-7),
      description: 'Portal role and permission configuration',
    },
    {
      id: '66666666-7777-8888-9999-000000000035',
      task_id: '22222222-3333-4444-5555-000000000005',
      user_id: '11111111-1111-1111-1111-000000000009',
      project_id: '11111111-2222-3333-4444-000000000004',
      hours_logged: 2.5,
      entry_date: getRelativeDate(-5),
      week_start_date: getWeekStart(-7),
      description: 'Onboarding workflow review and optimisation',
    },
  ];
}

function generateProjectUpdates() {
  const now = new Date();
  return [
    {
      id: '55555555-6666-7777-8888-000000000001',
      project_id: '11111111-2222-3333-4444-000000000001',
      content:
        'Frontend build kicked off. React component library scaffolded, design tokens imported from Figma. Dashboard and navigation components complete.',
      created_by: '11111111-1111-1111-1111-000000000006',
      created_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: '55555555-6666-7777-8888-000000000002',
      project_id: '11111111-2222-3333-4444-000000000001',
      content:
        'Portal dashboard and document vault designs approved by Meridian stakeholders. Client loved the new filtering approach. Moving into development sprint 3.',
      created_by: '11111111-1111-1111-1111-000000000005',
      created_at: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: '55555555-6666-7777-8888-000000000003',
      project_id: '11111111-2222-3333-4444-000000000003',
      content:
        'Responsive implementation going well. All breakpoints working on iOS. Focused on Android edge cases now — time slot grid overflow fixed.',
      created_by: '11111111-1111-1111-1111-000000000006',
      created_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: '55555555-6666-7777-8888-000000000004',
      project_id: '11111111-2222-3333-4444-000000000003',
      content:
        'Appointment booking design approved by Vanta Health product team. Client is thrilled with the calendar UX. Handing off to development this week.',
      created_by: '11111111-1111-1111-1111-000000000005',
      created_at: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: '55555555-6666-7777-8888-000000000005',
      project_id: '11111111-2222-3333-4444-000000000005',
      content:
        'Wordmark logo selected by Vanta Health CMO. Now working on colour palette, typography, and icon system for the full brand guidelines document.',
      created_by: '11111111-1111-1111-1111-000000000005',
      created_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: '55555555-6666-7777-8888-000000000006',
      project_id: '11111111-2222-3333-4444-000000000008',
      content:
        'Online ordering integration started. Menu page and cart flow complete. Setting up Stripe payment processing and Harlow merchant account next week.',
      created_by: '11111111-1111-1111-1111-000000000006',
      created_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

function generateMilestones() {
  return [
    {
      id: '88888888-9999-aaaa-bbbb-000000000001',
      name: 'Vanta Health App Beta Launch',
      description:
        'Patient app goes live with 50 pilot users — appointment booking, messaging, and prescription refill',
      date: getRelativeDate(14),
      color: '#ef4444',
    },
    {
      id: '88888888-9999-aaaa-bbbb-000000000002',
      name: 'Meridian Portal UAT Complete',
      description: 'User acceptance testing with Meridian advisors signed off',
      date: getRelativeDate(5),
      color: '#22c55e',
    },
    {
      id: '88888888-9999-aaaa-bbbb-000000000003',
      name: 'Meridian Portal Production Deploy',
      description: 'Full portal live in production for all Meridian clients',
      date: getRelativeDate(21),
      color: '#3b82f6',
    },
    {
      id: '88888888-9999-aaaa-bbbb-000000000004',
      name: 'Vanta Health Brand Guidelines Delivery',
      description: 'Complete 40-page brand book delivered as PDF and Figma library',
      date: getRelativeDate(18),
      color: '#a855f7',
    },
  ];
}

function generateUserAvailability() {
  return [
    // Dana Designer
    {
      id: '77777777-8888-9999-aaaa-000000000001',
      user_id: '11111111-1111-1111-1111-000000000005',
      week_start_date: getWeekStart(),
      available_hours: 40,
      notes: 'Full week available',
    },
    {
      id: '77777777-8888-9999-aaaa-000000000002',
      user_id: '11111111-1111-1111-1111-000000000005',
      week_start_date: getWeekStart(7),
      available_hours: 32,
      notes: 'Training on Friday',
    },
    // Dev Developer
    {
      id: '77777777-8888-9999-aaaa-000000000003',
      user_id: '11111111-1111-1111-1111-000000000006',
      week_start_date: getWeekStart(),
      available_hours: 40,
      notes: 'Full week available',
    },
    {
      id: '77777777-8888-9999-aaaa-000000000004',
      user_id: '11111111-1111-1111-1111-000000000006',
      week_start_date: getWeekStart(7),
      available_hours: 40,
      notes: 'Full week available',
    },
    // Pat Project Manager
    {
      id: '77777777-8888-9999-aaaa-000000000005',
      user_id: '11111111-1111-1111-1111-000000000004',
      week_start_date: getWeekStart(),
      available_hours: 40,
      notes: 'Full week available',
    },
    {
      id: '77777777-8888-9999-aaaa-000000000006',
      user_id: '11111111-1111-1111-1111-000000000004',
      week_start_date: getWeekStart(7),
      available_hours: 40,
      notes: 'Full week available',
    },
    // Alex Executive
    {
      id: '77777777-8888-9999-aaaa-000000000007',
      user_id: '11111111-1111-1111-1111-000000000002',
      week_start_date: getWeekStart(),
      available_hours: 20,
      notes: 'Part-time oversight - executive duties',
    },
    {
      id: '77777777-8888-9999-aaaa-000000000008',
      user_id: '11111111-1111-1111-1111-000000000002',
      week_start_date: getWeekStart(7),
      available_hours: 20,
      notes: 'Part-time oversight',
    },
    // Morgan Manager
    {
      id: '77777777-8888-9999-aaaa-000000000009',
      user_id: '11111111-1111-1111-1111-000000000003',
      week_start_date: getWeekStart(),
      available_hours: 35,
      notes: 'Account management focus',
    },
    {
      id: '77777777-8888-9999-aaaa-000000000010',
      user_id: '11111111-1111-1111-1111-000000000003',
      week_start_date: getWeekStart(7),
      available_hours: 35,
      notes: 'Account management focus',
    },
    // Andy Admin
    {
      id: '77777777-8888-9999-aaaa-000000000011',
      user_id: '11111111-1111-1111-1111-000000000009',
      week_start_date: getWeekStart(),
      available_hours: 40,
      notes: 'Full week available',
    },
    {
      id: '77777777-8888-9999-aaaa-000000000012',
      user_id: '11111111-1111-1111-1111-000000000009',
      week_start_date: getWeekStart(7),
      available_hours: 40,
      notes: 'Full week available',
    },
  ];
}

// Workflow Templates
function generateWorkflowTemplates() {
  return [
    {
      id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      name: 'Standard Project Delivery',
      description:
        'Standard workflow for client project delivery — design phase, internal review, development, QA, and client sign-off',
      created_by: '11111111-1111-1111-1111-000000000009',
      is_active: true,
    },
    {
      id: 'aaaaaaaa-bbbb-0000-0000-000000000002',
      name: 'Quick Turnaround',
      description:
        'Expedited workflow for urgent projects — combined design and development phase with a single final review',
      created_by: '11111111-1111-1111-1111-000000000009',
      is_active: true,
    },
  ];
}

// Workflow Nodes - using 'role' instead of deprecated 'department' node type
// Role IDs: Senior Designer = 10101010-1010-1010-1010-101010101010
//           Senior Developer = 30303030-3030-3030-3030-303030303030
//           Project Manager = ffffffff-ffff-ffff-ffff-ffffffffffff
//           Account Manager = eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee
// Settings use roleId/roleName for role nodes, approverRoleId/approverRoleName for approval nodes
function generateWorkflowNodes() {
  return [
    // Standard Project Delivery workflow nodes
    {
      id: 'bbbbbbbb-aaaa-0000-0000-000000000001',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      node_type: 'start',
      label: 'Project Kickoff',
      position_x: 100,
      position_y: 200,
      step_order: 0,
      settings: {},
    },
    {
      id: 'bbbbbbbb-aaaa-0000-0000-000000000002',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      node_type: 'role',
      entity_id: '10101010-1010-1010-1010-101010101010',
      label: 'Design Phase',
      position_x: 300,
      position_y: 200,
      step_order: 1,
      settings: { roleId: '10101010-1010-1010-1010-101010101010', roleName: 'Senior Designer' },
    },
    {
      id: 'bbbbbbbb-aaaa-0000-0000-000000000003',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      node_type: 'approval',
      entity_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      label: 'Design Approval',
      position_x: 500,
      position_y: 200,
      step_order: 2,
      settings: {
        approverRoleId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        approverRoleName: 'Project Manager',
      },
    },
    {
      id: 'bbbbbbbb-aaaa-0000-0000-000000000004',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      node_type: 'role',
      entity_id: '30303030-3030-3030-3030-303030303030',
      label: 'Development Phase',
      position_x: 700,
      position_y: 200,
      step_order: 3,
      settings: { roleId: '30303030-3030-3030-3030-303030303030', roleName: 'Senior Developer' },
    },
    {
      id: 'bbbbbbbb-aaaa-0000-0000-000000000005',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      node_type: 'approval',
      entity_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      label: 'QA Review',
      position_x: 900,
      position_y: 200,
      step_order: 4,
      settings: {
        approverRoleId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        approverRoleName: 'Project Manager',
      },
    },
    {
      id: 'bbbbbbbb-aaaa-0000-0000-000000000006',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      node_type: 'approval',
      entity_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      label: 'Client Sign-off',
      position_x: 1100,
      position_y: 200,
      step_order: 5,
      settings: {
        approverRoleId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        approverRoleName: 'Account Manager',
      },
    },
    {
      id: 'bbbbbbbb-aaaa-0000-0000-000000000007',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      node_type: 'end',
      label: 'Project Complete',
      position_x: 1300,
      position_y: 200,
      step_order: 6,
      settings: {},
    },
    // Quick Turnaround workflow nodes
    {
      id: 'bbbbbbbb-aaaa-0000-0000-000000000008',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000002',
      node_type: 'start',
      label: 'Quick Start',
      position_x: 100,
      position_y: 200,
      step_order: 0,
      settings: {},
    },
    {
      id: 'bbbbbbbb-aaaa-0000-0000-000000000009',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000002',
      node_type: 'role',
      entity_id: '10101010-1010-1010-1010-101010101010',
      label: 'Design & Dev',
      position_x: 300,
      position_y: 200,
      step_order: 1,
      settings: { roleId: '10101010-1010-1010-1010-101010101010', roleName: 'Senior Designer' },
    },
    {
      id: 'bbbbbbbb-aaaa-0000-0000-000000000010',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000002',
      node_type: 'approval',
      entity_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      label: 'Final Review',
      position_x: 500,
      position_y: 200,
      step_order: 2,
      settings: {
        approverRoleId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        approverRoleName: 'Project Manager',
      },
    },
    {
      id: 'bbbbbbbb-aaaa-0000-0000-000000000011',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000002',
      node_type: 'end',
      label: 'Delivered',
      position_x: 700,
      position_y: 200,
      step_order: 3,
      settings: {},
    },
  ];
}

// Workflow Connections - each approval node has both Approved and Rejected pathways
// Approval edges need condition JSONB with conditionType: 'approval_decision', conditionValue, decision for UI colors
function generateWorkflowConnections() {
  return [
    // Standard Project Delivery connections
    // Start -> Design Phase (no condition - regular edge)
    {
      id: 'bbbbbbbb-cccc-0000-0000-000000000001',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      from_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000001',
      to_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000002',
      label: 'Start Design',
      condition: null,
    },
    // Design Phase -> Design Approval (no condition - regular edge)
    {
      id: 'bbbbbbbb-cccc-0000-0000-000000000002',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      from_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000002',
      to_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000003',
      label: 'Submit for Approval',
      condition: null,
    },
    // Design Approval -> Development Phase (Approved - green edge)
    {
      id: 'bbbbbbbb-cccc-0000-0000-000000000003',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      from_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000003',
      to_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000004',
      label: 'Approved',
      condition: {
        conditionType: 'approval_decision',
        conditionValue: 'approved',
        decision: 'approved',
        label: 'Approved',
      },
    },
    // Design Approval -> Design Phase (Rejected - red edge)
    {
      id: 'bbbbbbbb-cccc-0000-0000-000000000010',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      from_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000003',
      to_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000002',
      label: 'Rejected',
      condition: {
        conditionType: 'approval_decision',
        conditionValue: 'rejected',
        decision: 'rejected',
        label: 'Rejected',
      },
    },
    // Development Phase -> QA Review (no condition - regular edge)
    {
      id: 'bbbbbbbb-cccc-0000-0000-000000000004',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      from_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000004',
      to_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000005',
      label: 'Ready for QA',
      condition: null,
    },
    // QA Review -> Client Sign-off (Approved - green edge)
    {
      id: 'bbbbbbbb-cccc-0000-0000-000000000005',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      from_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000005',
      to_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000006',
      label: 'QA Passed',
      condition: {
        conditionType: 'approval_decision',
        conditionValue: 'approved',
        decision: 'approved',
        label: 'QA Passed',
      },
    },
    // QA Review -> Development Phase (Rejected - red edge)
    {
      id: 'bbbbbbbb-cccc-0000-0000-000000000011',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      from_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000005',
      to_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000004',
      label: 'Rejected',
      condition: {
        conditionType: 'approval_decision',
        conditionValue: 'rejected',
        decision: 'rejected',
        label: 'Rejected',
      },
    },
    // Client Sign-off -> Project Complete (Approved - green edge)
    {
      id: 'bbbbbbbb-cccc-0000-0000-000000000006',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      from_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000006',
      to_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000007',
      label: 'Client Approved',
      condition: {
        conditionType: 'approval_decision',
        conditionValue: 'approved',
        decision: 'approved',
        label: 'Client Approved',
      },
    },
    // Client Sign-off -> Development Phase (Rejected - red edge)
    {
      id: 'bbbbbbbb-cccc-0000-0000-000000000012',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      from_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000006',
      to_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000004',
      label: 'Rejected',
      condition: {
        conditionType: 'approval_decision',
        conditionValue: 'rejected',
        decision: 'rejected',
        label: 'Rejected',
      },
    },

    // Quick Turnaround connections
    // Quick Start -> Design & Dev (no condition - regular edge)
    {
      id: 'bbbbbbbb-cccc-0000-0000-000000000007',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000002',
      from_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000008',
      to_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000009',
      label: 'Begin Work',
      condition: null,
    },
    // Design & Dev -> Final Review (no condition - regular edge)
    {
      id: 'bbbbbbbb-cccc-0000-0000-000000000008',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000002',
      from_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000009',
      to_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000010',
      label: 'Submit',
      condition: null,
    },
    // Final Review -> Delivered (Approved - green edge)
    {
      id: 'bbbbbbbb-cccc-0000-0000-000000000009',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000002',
      from_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000010',
      to_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000011',
      label: 'Approved',
      condition: {
        conditionType: 'approval_decision',
        conditionValue: 'approved',
        decision: 'approved',
        label: 'Approved',
      },
    },
    // Final Review -> Design & Dev (Rejected - red edge)
    {
      id: 'bbbbbbbb-cccc-0000-0000-000000000013',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000002',
      from_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000010',
      to_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000009',
      label: 'Rejected',
      condition: {
        conditionType: 'approval_decision',
        conditionValue: 'rejected',
        decision: 'rejected',
        label: 'Rejected',
      },
    },
  ];
}

// Workflow Instances - attach workflows to projects
function generateWorkflowInstances() {
  return [
    {
      id: 'cccccccc-0000-0000-0000-000000000001',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      project_id: '11111111-2222-3333-4444-000000000001',
      current_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000004',
      status: 'active',
    },
    {
      id: 'cccccccc-0000-0000-0000-000000000002',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      project_id: '11111111-2222-3333-4444-000000000003',
      current_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000004',
      status: 'active',
    },
    {
      id: 'cccccccc-0000-0000-0000-000000000003',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000002',
      project_id: '11111111-2222-3333-4444-000000000004',
      current_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000010',
      status: 'active',
    },
    {
      id: 'cccccccc-0000-0000-0000-000000000004',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      project_id: '11111111-2222-3333-4444-000000000005',
      current_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000003',
      status: 'active',
    },
    {
      id: 'cccccccc-0000-0000-0000-000000000005',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000001',
      project_id: '11111111-2222-3333-4444-000000000008',
      current_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000004',
      status: 'active',
    },
    {
      id: 'cccccccc-0000-0000-0000-000000000006',
      workflow_template_id: 'aaaaaaaa-bbbb-0000-0000-000000000002',
      project_id: '11111111-2222-3333-4444-000000000007',
      current_node_id: 'bbbbbbbb-aaaa-0000-0000-000000000011',
      status: 'completed',
    },
  ];
}

// Newsletters
function generateNewsletters() {
  const now = new Date();
  return [
    {
      id: 'eeeeeeee-0000-0000-0000-000000000001',
      title: 'March Agency Update: New Clients, Team News & Q2 Planning',
      content: `# March Agency Update\n\nHello Team,\n\nWe closed two new accounts this month — welcome to **Vanta Health** and **Harlow & Sons Bakery**. Both kick off in the next two weeks.\n\n## Team News\n- **Dana Designer** has been promoted to Lead Designer, effective April 1st. Congratulations Dana!\n- We are actively recruiting a mid-level developer and a junior designer. Send referrals to Morgan.\n\n## Q2 Planning\nQ2 planning sessions start next Monday. All project leads should have capacity estimates submitted by Friday EOD.\n\n## Process Update\nThe new approval workflow is live for all active projects. If you run into any issues, reach out to Andy in the #workflows Slack channel.\n\n*— Alex Executive*`,
      created_by: '11111111-1111-1111-1111-000000000002',
      is_published: true,
      published_at: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'eeeeeeee-0000-0000-0000-000000000002',
      title: "Q2 2025 Roadmap: What We're Building Next",
      content: `# Q2 2025 Roadmap\n\n## Client Work\n- **Meridian Financial Group** — Portal goes into development in April. Target delivery: end of May.\n- **Vanta Health** — Patient app beta targeting a May release with 50 pilot users.\n- **Harlow & Sons** — E-commerce integration kicks off in late April.\n\n## Internal Improvements\nBased on your feedback, we are shipping two improvements in April:\n- Easier week navigation in time tracking\n- New capacity planning view showing team utilisation at a glance\n\n## Hiring\nWe are recruiting a mid-level developer and a junior designer. Full details in the #hiring Slack channel.\n\nFull roadmap details are in Notion. Questions? Bring them to the all-hands on the 14th.\n\n*— Alex Executive*`,
      created_by: '11111111-1111-1111-1111-000000000009',
      is_published: true,
      published_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

// Project Issues
function generateProjectIssues() {
  const now = new Date();
  return [
    {
      id: 'dddddddd-0000-0000-0000-000000000001',
      project_id: '11111111-2222-3333-4444-000000000001',
      content:
        'Meridian legal has not approved the data handling clause in the portal SLA. Document vault feature is blocked until sign-off. Escalated to Morgan.',
      status: 'in_progress',
      created_by: '11111111-1111-1111-1111-000000000006',
      created_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'dddddddd-0000-0000-0000-000000000002',
      project_id: '11111111-2222-3333-4444-000000000001',
      content:
        'Need read access to Meridian production analytics database to validate the dashboard data model. Waiting on IT provisioning.',
      status: 'open',
      created_by: '11111111-1111-1111-1111-000000000006',
      created_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'dddddddd-0000-0000-0000-000000000003',
      project_id: '11111111-2222-3333-4444-000000000003',
      content:
        'Waiting for final copy from Vanta Health marketing team for the app onboarding screens. Blocking design handoff to development.',
      status: 'open',
      created_by: '11111111-1111-1111-1111-000000000005',
      created_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'dddddddd-0000-0000-0000-000000000004',
      project_id: '11111111-2222-3333-4444-000000000005',
      content:
        'Brand colour palette adjusted for WCAG AA contrast compliance. All combinations now pass. Updated Figma library shared with client.',
      status: 'resolved',
      created_by: '11111111-1111-1111-1111-000000000005',
      resolved_by: '11111111-1111-1111-1111-000000000005',
      created_at: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      resolved_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'dddddddd-0000-0000-0000-000000000005',
      project_id: '11111111-2222-3333-4444-000000000008',
      content:
        'Payment gateway integration delayed — Harlow & Sons merchant account application is still under review by Stripe. Estimated 3–5 business days.',
      status: 'open',
      created_by: '11111111-1111-1111-1111-000000000006',
      created_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

// Task Week Allocations for capacity planning
function generateTaskWeekAllocations() {
  return [
    // Current week allocations - Dev Developer
    {
      id: '99999999-0000-0000-0000-000000000001',
      task_id: '22222222-3333-4444-5555-000000000003',
      week_start_date: getWeekStart(),
      allocated_hours: 24,
      assigned_user_id: '11111111-1111-1111-1111-000000000006',
      notes: 'Frontend development sprint',
    },
    {
      id: '99999999-0000-0000-0000-000000000002',
      task_id: '22222222-3333-4444-5555-000000000004',
      week_start_date: getWeekStart(),
      allocated_hours: 16,
      assigned_user_id: '11111111-1111-1111-1111-000000000006',
      notes: 'API updates',
    },
    {
      id: '99999999-0000-0000-0000-000000000003',
      task_id: '22222222-3333-4444-5555-000000000008',
      week_start_date: getWeekStart(),
      allocated_hours: 20,
      assigned_user_id: '11111111-1111-1111-1111-000000000006',
      notes: 'Responsive work',
    },
    // Current week allocations - Dana Designer
    {
      id: '99999999-0000-0000-0000-000000000004',
      task_id: '22222222-3333-4444-5555-000000000011',
      week_start_date: getWeekStart(),
      allocated_hours: 8,
      assigned_user_id: '11111111-1111-1111-1111-000000000005',
      notes: 'Color palette finalization',
    },
    {
      id: '99999999-0000-0000-0000-000000000005',
      task_id: '22222222-3333-4444-5555-000000000013',
      week_start_date: getWeekStart(),
      allocated_hours: 16,
      assigned_user_id: '11111111-1111-1111-1111-000000000006',
      notes: 'Ordering system',
    },
    // Next week allocations
    {
      id: '99999999-0000-0000-0000-000000000006',
      task_id: '22222222-3333-4444-5555-000000000003',
      week_start_date: getWeekStart(7),
      allocated_hours: 32,
      assigned_user_id: '11111111-1111-1111-1111-000000000006',
      notes: 'Continue frontend',
    },
    {
      id: '99999999-0000-0000-0000-000000000007',
      task_id: '22222222-3333-4444-5555-000000000009',
      week_start_date: getWeekStart(7),
      allocated_hours: 8,
      assigned_user_id: '11111111-1111-1111-1111-000000000006',
      notes: 'Contact form',
    },
    {
      id: '99999999-0000-0000-0000-000000000008',
      task_id: '22222222-3333-4444-5555-000000000005',
      week_start_date: getWeekStart(7),
      allocated_hours: 24,
      assigned_user_id: '11111111-1111-1111-1111-000000000006',
      notes: 'QA testing',
    },
    // Andy Admin allocations - admin tasks (using QA Testing task since admin helps with QA)
    {
      id: '99999999-0000-0000-0000-000000000009',
      task_id: '22222222-3333-4444-5555-000000000005',
      week_start_date: getWeekStart(),
      allocated_hours: 8,
      assigned_user_id: '11111111-1111-1111-1111-000000000009',
      notes: 'QA coordination and testing support',
    },
    {
      id: '99999999-0000-0000-0000-000000000010',
      task_id: '22222222-3333-4444-5555-000000000009',
      week_start_date: getWeekStart(),
      allocated_hours: 4,
      assigned_user_id: '11111111-1111-1111-1111-000000000009',
      notes: 'Contact form review',
    },
    {
      id: '99999999-0000-0000-0000-000000000011',
      task_id: '22222222-3333-4444-5555-000000000005',
      week_start_date: getWeekStart(7),
      allocated_hours: 12,
      assigned_user_id: '11111111-1111-1111-1111-000000000009',
      notes: 'QA testing next week',
    },
  ];
}

// Project Stakeholders
function generateProjectStakeholders() {
  return [
    // Alex Executive as stakeholder on key projects
    {
      id: 'ffffffff-0000-0000-0000-000000000001',
      project_id: '11111111-2222-3333-4444-000000000001',
      user_id: '11111111-1111-1111-1111-000000000002',
      role: 'Executive Sponsor',
      added_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      id: 'ffffffff-0000-0000-0000-000000000002',
      project_id: '11111111-2222-3333-4444-000000000003',
      user_id: '11111111-1111-1111-1111-000000000002',
      role: 'Executive Sponsor',
      added_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      id: 'ffffffff-0000-0000-0000-000000000003',
      project_id: '11111111-2222-3333-4444-000000000005',
      user_id: '11111111-1111-1111-1111-000000000002',
      role: 'Executive Sponsor',
      added_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      id: 'ffffffff-0000-0000-0000-000000000004',
      project_id: '11111111-2222-3333-4444-000000000006',
      user_id: '11111111-1111-1111-1111-000000000002',
      role: 'Executive Sponsor',
      added_by: '11111111-1111-1111-1111-000000000003',
    },
    // Morgan Manager as stakeholder
    {
      id: 'ffffffff-0000-0000-0000-000000000005',
      project_id: '11111111-2222-3333-4444-000000000001',
      user_id: '11111111-1111-1111-1111-000000000003',
      role: 'Account Manager',
      added_by: '11111111-1111-1111-1111-000000000002',
    },
    {
      id: 'ffffffff-0000-0000-0000-000000000006',
      project_id: '11111111-2222-3333-4444-000000000003',
      user_id: '11111111-1111-1111-1111-000000000003',
      role: 'Account Manager',
      added_by: '11111111-1111-1111-1111-000000000002',
    },
  ];
}
const dynamic = 'force-dynamic';
const maxDuration = 60;

// CommonJS exports
exports.dynamic = dynamic;
exports.maxDuration = maxDuration;
exports.GET = GET;
