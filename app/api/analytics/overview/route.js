 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }/**
 * API Route: Analytics Overview
 * Returns comprehensive dashboard summary data for the analytics page
 */
const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { checkPermissionHybrid } = require('@/lib/permission-checker');
const { Permission } = require('@/lib/permissions');
const { startOfWeek, startOfMonth, endOfMonth, format } = require('date-fns');
const { logger } = require('@/lib/debug-logger');























































const dynamic = 'force-dynamic';
const revalidate = 60;
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

    // Require analytics or account analytics permission
    const hasAnalytics = await checkPermissionHybrid(
      userProfile,
      Permission.VIEW_ALL_ANALYTICS,
      undefined,
      admin,
    );
    const hasAccountAnalytics = await checkPermissionHybrid(
      userProfile,
      Permission.VIEW_ALL_ACCOUNT_ANALYTICS,
      undefined,
      admin,
    );
    if (!hasAnalytics && !hasAccountAnalytics) {
      return NextResponse.json(
        { error: 'Insufficient permissions to view analytics' },
        { status: 403 },
      );
    }

    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    // Fetch all data in parallel for performance
    const [
      projectsData,
      usersData,
      accountsData,
      workflowsData,
      tasksData,
      timeEntriesWeekData,
      timeEntriesMonthData,
      projectUpdatesData,
      availabilityData,
    ] = await Promise.all([
      // Projects
      admin.from('projects').select('id, status, priority, end_date, created_at, updated_at'),

      // Users
      admin.from('user_profiles').select('id, created_at'),

      // Accounts
      admin.from('accounts').select('id, status, service_tier'),

      // Workflow instances
      admin.from('workflow_instances').select('id, status, started_at, completed_at'),

      // Tasks
      admin.from('tasks').select('id, status, due_date'),

      // Time entries this week
      supabase
        .from('time_entries')
        .select('hours_logged, user_id')
        .gte('entry_date', format(weekStart, 'yyyy-MM-dd')),

      // Time entries this month
      supabase
        .from('time_entries')
        .select('hours_logged, user_id')
        .gte('entry_date', format(monthStart, 'yyyy-MM-dd'))
        .lte('entry_date', format(monthEnd, 'yyyy-MM-dd')),

      // Recent project updates for activity feed
      supabase
        .from('project_updates')
        .select('id, content, created_at, projects(name)')
        .order('created_at', { ascending: false })
        .limit(5),

      // User availability for utilization
      supabase
        .from('user_availability')
        .select('user_id, available_hours')
        .eq('week_start_date', format(weekStart, 'yyyy-MM-dd')),
    ]);

    // Process Projects
    const projects = projectsData.data || [];
    const activeProjects = projects.filter((p) =>
      ['planning', 'in_progress', 'review'].includes(p.status),
    );
    const completedThisMonth = projects.filter(
      (p) => p.status === 'complete' && p.updated_at && new Date(p.updated_at) >= monthStart,
    );

    // Calculate on-time rate (completed projects that met their deadline)
    // A project is "on time" if it was completed (updated_at) before or on its deadline (end_date)
    const completedWithDeadline = projects.filter(
      (p) => p.status === 'complete' && p.end_date,
    );
    const onTimeProjects = completedWithDeadline.filter(
      (p) => p.updated_at && new Date(p.updated_at) <= new Date(p.end_date),
    );
    const onTimeRate =
      completedWithDeadline.length > 0
        ? Math.round((onTimeProjects.length / completedWithDeadline.length) * 100)
        : 100;

    // Group by status and priority
    const statusCounts = {};
    const priorityCounts = {};
    projects.forEach((p) => {
      statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
      priorityCounts[p.priority || 'medium'] = (priorityCounts[p.priority || 'medium'] || 0) + 1;
    });

    // Process Team
    const users = usersData.data || [];
    const timeEntriesWeek = timeEntriesWeekData.data || [];
    const timeEntriesMonth = timeEntriesMonthData.data || [];
    const availability = availabilityData.data || [];

    const hoursLoggedThisWeek = timeEntriesWeek.reduce(
      (sum, te) => sum + (te.hours_logged || 0),
      0,
    );
    const hoursLoggedThisMonth = timeEntriesMonth.reduce(
      (sum, te) => sum + (te.hours_logged || 0),
      0,
    );

    // Active users = users who logged time this month
    const activeUserIds = new Set(timeEntriesMonth.map((te) => te.user_id));

    // Calculate average utilization
    const totalAvailableHours = availability.reduce(
      (sum, a) => sum + (a.available_hours || 40),
      0,
    );
    const avgUtilization =
      totalAvailableHours > 0 ? Math.round((hoursLoggedThisWeek / totalAvailableHours) * 100) : 0;

    // Process Accounts
    const accounts = accountsData.data || [];
    const activeAccounts = accounts.filter((a) => a.status === 'active');
    const tierCounts = {};
    accounts.forEach((a) => {
      const tier = a.service_tier || 'basic';
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    });

    // Process Workflows
    const workflows = workflowsData.data || [];
    const activeWorkflows = workflows.filter((w) => w.status === 'active');
    const completedWorkflowsThisMonth = workflows.filter(
      (w) =>
        w.status === 'completed' && w.completed_at && new Date(w.completed_at) >= monthStart,
    );

    // Calculate average completion time
    const completedWithTimes = workflows.filter(
      (w) => w.status === 'completed' && w.started_at && w.completed_at,
    );
    let avgCompletionDays = 0;
    if (completedWithTimes.length > 0) {
      const totalDays = completedWithTimes.reduce((sum, w) => {
        const start = new Date(w.started_at);
        const end = new Date(w.completed_at);
        return sum + Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      }, 0);
      avgCompletionDays = Math.round(totalDays / completedWithTimes.length);
    }

    // Process Tasks
    const tasks = tasksData.data || [];
    const completedTasks = tasks.filter((t) => t.status === 'done' || t.status === 'complete');
    const inProgressTasks = tasks.filter((t) => t.status === 'in_progress');
    const overdueTasks = tasks.filter((t) => {
      if (!t.due_date || t.status === 'done' || t.status === 'complete') return false;
      return new Date(t.due_date) < now;
    });
    const taskCompletionRate =
      tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0;

    // Generate insights
    const insights = [];

    if (avgUtilization > 90) {
      insights.push(`Team utilization is at ${avgUtilization}% - consider redistributing workload`);
    } else if (avgUtilization < 50) {
      insights.push(
        `Team utilization is at ${avgUtilization}% - capacity available for new projects`,
      );
    }

    if (overdueTasks.length > 0) {
      insights.push(
        `${overdueTasks.length} task${overdueTasks.length > 1 ? 's are' : ' is'} overdue`,
      );
    }

    if (completedThisMonth.length > 0) {
      insights.push(
        `${completedThisMonth.length} project${completedThisMonth.length > 1 ? 's' : ''} completed this month`,
      );
    }

    if (onTimeRate < 80) {
      insights.push(`On-time delivery rate is ${onTimeRate}% - review project timelines`);
    }

    // Build recent activity from project updates
    const projectUpdates = projectUpdatesData.data || [];
    const recentActivity = projectUpdates.map((update) => ({
      type: 'update',
      message: `Update on ${_optionalChain([(update.projects ), 'optionalAccess', _ => _.name]) || 'Unknown Project'}`,
      timestamp: update.created_at,
    }));

    const response = {
      projects: {
        total: projects.length,
        active: activeProjects.length,
        completedThisMonth: completedThisMonth.length,
        onTimeRate,
        byStatus: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
        byPriority: Object.entries(priorityCounts).map(([priority, count]) => ({
          priority,
          count,
        })),
      },
      team: {
        totalUsers: users.length,
        activeUsers: activeUserIds.size,
        avgUtilization,
        hoursLoggedThisWeek: Math.round(hoursLoggedThisWeek * 10) / 10,
        hoursLoggedThisMonth: Math.round(hoursLoggedThisMonth * 10) / 10,
      },
      accounts: {
        total: accounts.length,
        active: activeAccounts.length,
        byServiceTier: Object.entries(tierCounts).map(([tier, count]) => ({ tier, count })),
      },
      workflows: {
        active: activeWorkflows.length,
        completedThisMonth: completedWorkflowsThisMonth.length,
        avgCompletionDays,
      },
      tasks: {
        total: tasks.length,
        completed: completedTasks.length,
        inProgress: inProgressTasks.length,
        overdue: overdueTasks.length,
        completionRate: taskCompletionRate,
      },
      recentActivity,
      insights,
    };

    return NextResponse.json({
      success: true,
      data: response,
    });
  } catch (error) {
    const err = error ;
    logger.error('Error in GET /api/analytics/overview', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.dynamic = dynamic;
exports.revalidate = revalidate;
exports.GET = GET;
