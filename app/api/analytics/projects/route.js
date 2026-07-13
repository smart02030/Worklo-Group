 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }/**
 * API Route: Project Analytics
 * Returns detailed project metrics and trends
 */
const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { checkPermissionHybrid } = require('@/lib/permission-checker');
const { Permission } = require('@/lib/permissions');
const { subDays, format, eachDayOfInterval, eachWeekOfInterval } = require('date-fns');
const { logger } = require('@/lib/debug-logger');







function getDateRange(range) {
  const now = new Date();
  const end = now;

  switch (range) {
    case '7d':
      return { start: subDays(now, 7), end };
    case '30d':
      return { start: subDays(now, 30), end };
    case '90d':
      return { start: subDays(now, 90), end };
    case 'ytd':
      return { start: new Date(now.getFullYear(), 0, 1), end };
    case 'all':
      return { start: new Date(2020, 0, 1), end };
    default:
      return { start: subDays(now, 30), end };
  }
}
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

    // Check if user has full analytics access or just project-level access
    const hasAllAnalytics = await checkPermissionHybrid(
      userProfile,
      Permission.VIEW_ALL_ANALYTICS,
      undefined,
      admin,
    );
    const hasProjectAccess = await checkPermissionHybrid(
      userProfile,
      Permission.VIEW_PROJECTS,
      undefined,
      admin,
    );
    if (!hasAllAnalytics && !hasProjectAccess) {
      return NextResponse.json(
        { error: 'Insufficient permissions to view project analytics' },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const dateRange = (searchParams.get('dateRange') || '30d') ;
    const accountId = searchParams.get('accountId');

    const { start, end } = getDateRange(dateRange);
    const startStr = format(start, 'yyyy-MM-dd');
    const endStr = format(end, 'yyyy-MM-dd');

    // Build project query
    let projectQuery = supabase.from('projects').select(`
        id,
        name,
        status,
        priority,
        start_date,
        end_date,
        estimated_hours,
        actual_hours,
        created_at,
        account_id,
        accounts(name)
      `);

    if (accountId) {
      projectQuery = projectQuery.eq('account_id', accountId);
    }

    // Fetch data in parallel
    const [projectsData, tasksData, timeEntriesData] = await Promise.all([
      projectQuery,
      supabase
        .from('tasks')
        .select(
          'id, project_id, status, priority, estimated_hours, actual_hours, due_date, created_at',
        ),
      supabase
        .from('time_entries')
        .select('project_id, hours_logged, entry_date')
        .gte('entry_date', startStr)
        .lte('entry_date', endStr),
    ]);

    const projects = projectsData.data || [];
    const _tasks = tasksData.data || [];
    const timeEntries = timeEntriesData.data || [];

    // Calculate summary metrics
    const activeProjects = projects.filter((p) =>
      ['planning', 'in_progress', 'review'].includes(p.status),
    );
    const completedProjects = projects.filter((p) => p.status === 'complete');
    const onHoldProjects = projects.filter((p) => p.status === 'on_hold');

    // Status distribution
    const statusDistribution = [
      {
        status: 'planning',
        count: projects.filter((p) => p.status === 'planning').length,
        color: '#94a3b8',
      },
      {
        status: 'in_progress',
        count: projects.filter((p) => p.status === 'in_progress').length,
        color: '#3b82f6',
      },
      {
        status: 'review',
        count: projects.filter((p) => p.status === 'review').length,
        color: '#f59e0b',
      },
      { status: 'complete', count: completedProjects.length, color: '#10b981' },
      { status: 'on_hold', count: onHoldProjects.length, color: '#ef4444' },
    ].filter((s) => s.count > 0);

    // Priority distribution
    const priorityDistribution = [
      {
        priority: 'urgent',
        count: projects.filter((p) => p.priority === 'urgent').length,
        color: '#ef4444',
      },
      {
        priority: 'high',
        count: projects.filter((p) => p.priority === 'high').length,
        color: '#f97316',
      },
      {
        priority: 'medium',
        count: projects.filter((p) => p.priority === 'medium').length,
        color: '#eab308',
      },
      {
        priority: 'low',
        count: projects.filter((p) => p.priority === 'low').length,
        color: '#22c55e',
      },
    ].filter((p) => p.count > 0);

    // Timeline - projects created/completed over time
    const timelineData = [];

    if (dateRange === '7d' || dateRange === '30d') {
      // Daily granularity
      const days = eachDayOfInterval({ start, end });
      days.forEach((day) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const label = format(day, 'MMM d');
        const created = projects.filter(
          (p) => format(new Date(p.created_at), 'yyyy-MM-dd') === dateStr,
        ).length;
        const completed = projects.filter(
          (p) =>
            p.status === 'complete' &&
            p.end_date &&
            format(new Date(p.end_date), 'yyyy-MM-dd') === dateStr,
        ).length;
        timelineData.push({ date: label, created, completed });
      });
    } else {
      // Weekly granularity
      const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
      weeks.forEach((weekStart) => {
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const label = format(weekStart, 'MMM d');
        const created = projects.filter((p) => {
          const createdDate = new Date(p.created_at);
          return createdDate >= weekStart && createdDate <= weekEnd;
        }).length;
        const completed = projects.filter((p) => {
          if (p.status !== 'complete' || !p.end_date) return false;
          const endDate = new Date(p.end_date);
          return endDate >= weekStart && endDate <= weekEnd;
        }).length;
        timelineData.push({ date: label, created, completed });
      });
    }

    // Hours by project (top 10)
    const projectHours =
      [];
    projects.forEach((p) => {
      const projectTimeEntries = timeEntries.filter((te) => te.project_id === p.id);
      const loggedHours = projectTimeEntries.reduce(
        (sum, te) => sum + (te.hours_logged || 0),
        0,
      );
      const estimated = p.estimated_hours || 0;
      const actual = loggedHours || p.actual_hours || 0;
      const remaining = Math.max(0, estimated - actual);

      if (estimated > 0 || actual > 0) {
        projectHours.push({
          name: p.name.length > 20 ? p.name.substring(0, 17) + '...' : p.name,
          estimated,
          actual,
          remaining,
        });
      }
    });

    // Sort by total hours and take top 10
    projectHours.sort((a, b) => b.estimated + b.actual - (a.estimated + a.actual));
    const topProjectHours = projectHours.slice(0, 10);

    // Calculate health score (0-100)
    const now = new Date();
    let healthPoints = 100;

    // Deduct for overdue projects
    const overdueProjects = projects.filter(
      (p) => p.end_date && new Date(p.end_date) < now && p.status !== 'complete',
    );
    healthPoints -= overdueProjects.length * 5;

    // Deduct for projects significantly over budget
    const overBudgetProjects = projects.filter(
      (p) => p.estimated_hours > 0 && (p.actual_hours || 0) > p.estimated_hours * 1.2,
    );
    healthPoints -= overBudgetProjects.length * 3;

    // Add points for completed projects
    healthPoints += Math.min(20, completedProjects.length * 2);

    // Ensure between 0-100
    const healthScore = Math.max(0, Math.min(100, healthPoints));

    // Estimated vs Actual hours
    const totalEstimated = projects.reduce(
      (sum, p) => sum + (p.estimated_hours || 0),
      0,
    );
    const totalActual = timeEntries.reduce(
      (sum, te) => sum + (te.hours_logged || 0),
      0,
    );
    const estimateAccuracy =
      totalEstimated > 0
        ? Math.round((1 - Math.abs(totalActual - totalEstimated) / totalEstimated) * 100)
        : 100;

    // Hours by account (top 5)
    const accountHours = {};
    timeEntries.forEach((te) => {
      const project = projects.find((p) => p.id === te.project_id);
      if (project && project.account_id) {
        const accountName = _optionalChain([(project.accounts ), 'optionalAccess', _ => _.name]) || 'Unknown';
        if (!accountHours[project.account_id]) {
          accountHours[project.account_id] = { name: accountName, hours: 0 };
        }
        accountHours[project.account_id].hours += te.hours_logged || 0;
      }
    });

    const hoursByAccount = Object.values(accountHours)
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 5)
      .map((a) => ({
        name: a.name.length > 15 ? a.name.substring(0, 12) + '...' : a.name,
        hours: Math.round(a.hours * 10) / 10,
      }));

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          total: projects.length,
          active: activeProjects.length,
          completed: completedProjects.length,
          onHold: onHoldProjects.length,
          healthScore,
          estimateAccuracy,
        },
        statusDistribution,
        priorityDistribution,
        timeline: timelineData,
        topProjectHours,
        hoursByAccount,
        estimatedVsActual: {
          estimated: Math.round(totalEstimated * 10) / 10,
          actual: Math.round(totalActual * 10) / 10,
          variance: Math.round((totalActual - totalEstimated) * 10) / 10,
        },
      },
      dateRange,
    });
  } catch (error) {
    const err = error ;
    logger.error('Error in GET /api/analytics/projects', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.dynamic = dynamic;
exports.revalidate = revalidate;
exports.GET = GET;
