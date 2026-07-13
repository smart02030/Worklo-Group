 function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } } function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }/**
 * API Route: Team Analytics
 * Returns detailed team performance metrics
 */
const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { checkPermissionHybrid } = require('@/lib/permission-checker');
const { Permission } = require('@/lib/permissions');
const { subDays, format, startOfWeek, getDay } = require('date-fns');
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

    // Require analytics permission (VIEW_ALL_ANALYTICS or VIEW_ALL_DEPARTMENT_ANALYTICS)
    const hasAnalytics = await checkPermissionHybrid(
      userProfile,
      Permission.VIEW_ALL_ANALYTICS,
      undefined,
      admin,
    );
    const hasDeptAnalytics = await checkPermissionHybrid(
      userProfile,
      Permission.VIEW_ALL_DEPARTMENT_ANALYTICS,
      undefined,
      admin,
    );
    if (!hasAnalytics && !hasDeptAnalytics) {
      return NextResponse.json(
        { error: 'Insufficient permissions to view team analytics' },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const dateRange = (searchParams.get('dateRange') || '30d') ;
    const departmentId = searchParams.get('departmentId');

    const { start, end } = getDateRange(dateRange);
    const startStr = format(start, 'yyyy-MM-dd');
    const endStr = format(end, 'yyyy-MM-dd');
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

    // Fetch users first (workload_sentiment may not exist in older schemas)
    let usersData = await admin
      .from('user_profiles')
      .select('id, name, email, workload_sentiment, created_at');

    if (usersData.error && (usersData.error ).code === '42703') {
      const fallback = await admin.from('user_profiles').select('id, name, email, created_at');

      usersData = {
        ...fallback,
        data:
          _nullishCoalesce(_optionalChain([(fallback.data ), 'optionalAccess', _ => _.map, 'call', _2 => _2((u) => ({
            ...u,
            workload_sentiment: null,
          }))]), () => ( null)),
      } ;
    }

    // Fetch remaining data in parallel
    const [
      timeEntriesData,
      availabilityData,
      tasksData,
      departmentsData,
      rolesData,
      userRolesData,
    ] = await Promise.all([
      supabase
        .from('time_entries')
        .select('user_id, hours_logged, entry_date')
        .gte('entry_date', startStr)
        .lte('entry_date', endStr),
      supabase
        .from('user_availability')
        .select('user_id, available_hours, week_start_date')
        .eq('week_start_date', format(weekStart, 'yyyy-MM-dd')),
      supabase.from('tasks').select('id, assigned_to, status').gte('created_at', startStr),
      admin.from('departments').select('id, name'),
      admin.from('roles').select('id, name, department_id'),
      admin.from('user_roles').select('user_id, role_id'),
    ]);

    const users = usersData.data || [];
    const timeEntries = timeEntriesData.data || [];
    const availability = availabilityData.data || [];
    const tasks = tasksData.data || [];
    const departments = departmentsData.data || [];
    const roles = rolesData.data || [];
    const userRoles = userRolesData.data || [];

    // Filter users by department if specified
    let filteredUserIds = users.map((u) => u.id);
    if (departmentId) {
      const deptRoleIds = roles
        .filter((r) => r.department_id === departmentId)
        .map((r) => r.id);
      filteredUserIds = userRoles
        .filter((ur) => deptRoleIds.includes(ur.role_id))
        .map((ur) => ur.user_id);
    }

    const filteredUsers = users.filter((u) => filteredUserIds.includes(u.id));
    const filteredTimeEntries = timeEntries.filter((te) =>
      filteredUserIds.includes(te.user_id),
    );

    // Calculate utilization data per user
    const utilizationData = [];
    const availabilityMap = new Map();
    availability.forEach((a) => {
      availabilityMap.set(a.user_id, a.available_hours || 40);
    });

    const userHoursMap = new Map();
    filteredTimeEntries.forEach((te) => {
      const current = userHoursMap.get(te.user_id) || 0;
      userHoursMap.set(te.user_id, current + (te.hours_logged || 0));
    });

    filteredUsers.forEach((user) => {
      const hoursLogged = userHoursMap.get(user.id) || 0;
      const availableHours = availabilityMap.get(user.id) || 40;
      // Calculate expected hours based on date range
      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      const weeks = Math.max(1, days / 7);
      const expectedHours = availableHours * weeks;
      const utilization = expectedHours > 0 ? Math.round((hoursLogged / expectedHours) * 100) : 0;

      utilizationData.push({
        name: _optionalChain([user, 'access', _3 => _3.name, 'optionalAccess', _4 => _4.split, 'call', _5 => _5(' '), 'access', _6 => _6[0]]) || 'Unknown',
        utilization: Math.min(200, utilization), // Cap at 200%
        hoursLogged: Math.round(hoursLogged * 10) / 10,
      });
    });

    // Sort by hours logged and take top 10
    utilizationData.sort((a, b) => b.hoursLogged - a.hoursLogged);
    const topPerformers = utilizationData.slice(0, 10);

    // Calculate workload distribution
    const workloadBuckets = {
      'Under 60%': 0,
      '60-80%': 0,
      '80-100%': 0,
      'Over 100%': 0,
    };

    utilizationData.forEach((u) => {
      if (u.utilization < 60) workloadBuckets['Under 60%']++;
      else if (u.utilization < 80) workloadBuckets['60-80%']++;
      else if (u.utilization <= 100) workloadBuckets['80-100%']++;
      else workloadBuckets['Over 100%']++;
    });

    const workloadDistribution = [
      { range: 'Under 60%', count: workloadBuckets['Under 60%'], color: '#94a3b8' },
      { range: '60-80%', count: workloadBuckets['60-80%'], color: '#22c55e' },
      { range: '80-100%', count: workloadBuckets['80-100%'], color: '#3b82f6' },
      { range: 'Over 100%', count: workloadBuckets['Over 100%'], color: '#ef4444' },
    ];

    // Sentiment aggregation
    const sentimentCounts = {
      comfortable: 0,
      stretched: 0,
      overwhelmed: 0,
      unknown: 0,
    };

    filteredUsers.forEach((u) => {
      const sentiment = u.workload_sentiment || 'unknown';
      if (sentiment in sentimentCounts) {
        sentimentCounts[sentiment ]++;
      }
    });

    const sentimentData = [
      { sentiment: 'Comfortable', count: sentimentCounts.comfortable, color: '#22c55e' },
      { sentiment: 'Stretched', count: sentimentCounts.stretched, color: '#f59e0b' },
      { sentiment: 'Overwhelmed', count: sentimentCounts.overwhelmed, color: '#ef4444' },
    ].filter((s) => s.count > 0);

    // Activity by day of week (heatmap data)
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const activityByDay = dayNames.map((day) => ({
      day,
      hours: 0,
    }));

    filteredTimeEntries.forEach((te) => {
      const dayOfWeek = getDay(new Date(te.entry_date));
      activityByDay[dayOfWeek].hours += te.hours_logged || 0;
    });

    // Rearrange to start from Monday
    const activityByDayOrdered = [
      activityByDay[1], // Mon
      activityByDay[2], // Tue
      activityByDay[3], // Wed
      activityByDay[4], // Thu
      activityByDay[5], // Fri
      activityByDay[6], // Sat
      activityByDay[0], // Sun
    ];

    // Calculate department breakdown
    const departmentStats = [];
    departments.forEach((dept) => {
      const deptRoleIds = roles
        .filter((r) => r.department_id === dept.id)
        .map((r) => r.id);
      const deptUserIds = userRoles
        .filter((ur) => deptRoleIds.includes(ur.role_id))
        .map((ur) => ur.user_id);
      const uniqueDeptUserIds = [...new Set(deptUserIds)];
      const deptHours = timeEntries
        .filter((te) => deptUserIds.includes(te.user_id))
        .reduce((sum, te) => sum + (te.hours_logged || 0), 0);

      if (uniqueDeptUserIds.length > 0) {
        departmentStats.push({
          name: dept.name.length > 15 ? dept.name.substring(0, 12) + '...' : dept.name,
          users: uniqueDeptUserIds.length,
          hours: Math.round(deptHours * 10) / 10,
        });
      }
    });

    departmentStats.sort((a, b) => b.hours - a.hours);

    // Calculate summary metrics
    const totalHoursLogged = filteredTimeEntries.reduce(
      (sum, te) => sum + (te.hours_logged || 0),
      0,
    );
    const avgHoursPerUser =
      filteredUsers.length > 0
        ? Math.round((totalHoursLogged / filteredUsers.length) * 10) / 10
        : 0;
    const avgUtilization =
      utilizationData.length > 0
        ? Math.round(
            utilizationData.reduce((sum, u) => sum + u.utilization, 0) / utilizationData.length,
          )
        : 0;

    // Task completion rate
    const completedTasks = tasks.filter(
      (t) =>
        filteredUserIds.includes(t.assigned_to) && (t.status === 'done' || t.status === 'complete'),
    ).length;
    const totalAssignedTasks = tasks.filter((t) =>
      filteredUserIds.includes(t.assigned_to),
    ).length;
    const taskCompletionRate =
      totalAssignedTasks > 0 ? Math.round((completedTasks / totalAssignedTasks) * 100) : 0;

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalUsers: filteredUsers.length,
          activeUsers: userHoursMap.size,
          avgUtilization,
          totalHoursLogged: Math.round(totalHoursLogged * 10) / 10,
          avgHoursPerUser,
          taskCompletionRate,
        },
        topPerformers,
        workloadDistribution,
        sentimentData,
        activityByDay: activityByDayOrdered,
        departmentStats: departmentStats.slice(0, 6),
      },
      dateRange,
    });
  } catch (error) {
    const err = error ;
    logger.error('Error in GET /api/analytics/team', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.dynamic = dynamic;
exports.revalidate = revalidate;
exports.GET = GET;
