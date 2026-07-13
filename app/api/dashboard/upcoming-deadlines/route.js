 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }/**
 * API Route: Upcoming Deadlines
 * Returns tasks with due dates in the next 14 days
 */
const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { format, addDays, differenceInDays, isPast, isToday } = require('date-fns');
const { logger } = require('@/lib/debug-logger');
const { checkPermissionHybrid } = require('@/lib/permission-checker');
const { Permission } = require('@/lib/permissions');
const dynamic = 'force-dynamic';














async function GET(request) {
  try {
    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection not available' }, { status: 500 });
    }

    const userProfile = await getUserProfileFromRequest(supabase);
    if (!userProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = userProfile.id;
    const now = new Date();
    const _twoWeeksFromNow = addDays(now, 14);

    // Get tasks assigned to user with due dates (including overdue - no max date filter)
    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select(
        `
        id,
        name,
        due_date,
        status,
        priority,
        project_id,
        projects(id, name)
      `,
      )
      .eq('assigned_to', userId)
      .not('status', 'eq', 'done')
      .not('due_date', 'is', null)
      .order('due_date', { ascending: true })
      .limit(20);

    if (tasksError) {
      logger.error('Error fetching task deadlines', {}, tasksError );
    }

    // Check if user can see all projects
    const canViewAll = await checkPermissionHybrid(
      userProfile,
      Permission.VIEW_ALL_PROJECTS,
      undefined,
      admin,
    );

    let projects = [];

    if (canViewAll) {
      // User has VIEW_ALL_PROJECTS — show all project deadlines
      const { data: projectData, error: projectsError } = await supabase
        .from('projects')
        .select('id, name, end_date, status, priority, account_id, accounts(name)')
        .not('status', 'eq', 'complete')
        .not('end_date', 'is', null)
        .order('end_date', { ascending: true })
        .limit(20);

      if (projectsError) {
        logger.error('Error fetching project deadlines', {}, projectsError );
      } else {
        projects = projectData || [];
      }
    } else {
      // Get projects the user can see: assigned via project_assignments, assigned_user_id, or created_by
      const { data: assignments } = await supabase
        .from('project_assignments')
        .select('project_id')
        .eq('user_id', userId)
        .is('removed_at', null);

      const assignedProjectIds = new Set(_optionalChain([assignments, 'optionalAccess', _ => _.map, 'call', _2 => _2((a) => a.project_id)]) || []);

      const { data: ownedProjects } = await supabase
        .from('projects')
        .select('id')
        .or(`assigned_user_id.eq.${userId},created_by.eq.${userId}`)
        .not('status', 'eq', 'complete');

      (ownedProjects || []).forEach((p) => assignedProjectIds.add(p.id));

      const projectIds = Array.from(assignedProjectIds);

      if (projectIds.length > 0) {
        const { data: projectData, error: projectsError } = await supabase
          .from('projects')
          .select('id, name, end_date, status, priority, account_id, accounts(name)')
          .in('id', projectIds)
          .not('status', 'eq', 'complete')
          .not('end_date', 'is', null)
          .order('end_date', { ascending: true })
          .limit(20);

        if (projectsError) {
          logger.error('Error fetching project deadlines', {}, projectsError );
        } else {
          projects = projectData || [];
        }
      }
    }

    const deadlines = [];

    // Add task deadlines
    (tasks || []).forEach((task) => {
      const dueDate = new Date(task.due_date);
      const daysUntil = differenceInDays(dueDate, now);
      const project = Array.isArray(task.projects) ? task.projects[0] : task.projects;

      let dueDateLabel = format(dueDate, 'MMM d');
      if (isToday(dueDate)) {
        dueDateLabel = 'Today';
      } else if (isPast(dueDate)) {
        dueDateLabel = `${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''} overdue`;
      } else if (daysUntil === 1) {
        dueDateLabel = 'Tomorrow';
      } else if (daysUntil <= 7) {
        dueDateLabel = `In ${daysUntil} days`;
      }

      deadlines.push({
        id: task.id,
        name: task.name,
        dueDate: task.due_date,
        dueDateLabel,
        projectName: _optionalChain([project, 'optionalAccess', _3 => _3.name]) || 'No Project',
        projectId: task.project_id,
        status: task.status,
        priority: task.priority,
        isOverdue: isPast(dueDate) && !isToday(dueDate),
        isDueToday: isToday(dueDate),
        daysUntilDue: daysUntil,
      });
    });

    // Add project deadlines
    projects.forEach((project) => {
      const dueDate = new Date(project.end_date);
      const daysUntil = differenceInDays(dueDate, now);
      const account = Array.isArray(project.accounts) ? project.accounts[0] : project.accounts;

      let dueDateLabel = format(dueDate, 'MMM d');
      if (isToday(dueDate)) {
        dueDateLabel = 'Today';
      } else if (isPast(dueDate)) {
        dueDateLabel = `${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''} overdue`;
      } else if (daysUntil === 1) {
        dueDateLabel = 'Tomorrow';
      } else if (daysUntil <= 7) {
        dueDateLabel = `In ${daysUntil} days`;
      }

      deadlines.push({
        id: `project-${project.id}`,
        name: `📁 ${project.name}`,
        dueDate: project.end_date,
        dueDateLabel,
        projectName: _optionalChain([account, 'optionalAccess', _4 => _4.name]) || 'No Account',
        projectId: project.id,
        status: project.status,
        priority: project.priority || 'medium',
        isOverdue: isPast(dueDate) && !isToday(dueDate),
        isDueToday: isToday(dueDate),
        daysUntilDue: daysUntil,
      });
    });

    // Sort by due date (overdue first, then by date)
    deadlines.sort((a, b) => {
      // Overdue items first
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      // Then by due date
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

    // Count by urgency
    const overdueCount = deadlines.filter((d) => d.isOverdue).length;
    const dueTodayCount = deadlines.filter((d) => d.isDueToday).length;
    const thisWeekCount = deadlines.filter(
      (d) => !d.isOverdue && !d.isDueToday && d.daysUntilDue <= 7,
    ).length;

    return NextResponse.json({
      success: true,
      data: {
        deadlines,
        overdueCount,
        dueTodayCount,
        thisWeekCount,
        totalCount: deadlines.length,
      },
    });
  } catch (error) {
    logger.error('Error in GET /api/dashboard/upcoming-deadlines', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.dynamic = dynamic;
exports.GET = GET;
