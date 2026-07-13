 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }/**
 * API Route: Time by Project
 * Returns hours logged per project for the current week
 */
const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { startOfWeek, endOfWeek, format } = require('date-fns');
const { logger } = require('@/lib/debug-logger');
const dynamic = 'force-dynamic';









// Colors for the pie chart - Brand colors (blue primary + gray variants)
const COLORS = [
  '#007EE5', // accent blue (primary)
  '#647878', // gray
  '#787878', // gray
  '#7B8994', // gray
  '#3D464D', // gray
  '#475250', // gray
  '#4A5D3A', // olive (for variety)
  '#282828', // dark gray
];
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

    // Get current week range (Monday to Sunday)
    // Extend by 1 day to handle timezone differences
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    const nextDay = new Date(weekEnd);
    nextDay.setDate(nextDay.getDate() + 1);
    const weekStartStr = format(weekStart, 'yyyy-MM-dd');
    const weekEndStr = format(nextDay, 'yyyy-MM-dd');

    // Get time entries for this week grouped by project
    const { data: timeEntries, error } = await supabase
      .from('time_entries')
      .select(
        `
        hours_logged,
        project_id,
        projects(
          id,
          name,
          accounts(name)
        )
      `,
      )
      .eq('user_id', userId)
      .gte('entry_date', weekStartStr)
      .lte('entry_date', weekEndStr);

    if (error) {
      logger.error('Error fetching time entries', {}, error );
      return NextResponse.json({ error: 'Failed to fetch time data' }, { status: 500 });
    }

    // Aggregate by project
    const projectMap = new Map();

    _optionalChain([timeEntries, 'optionalAccess', _ => _.forEach, 'call', _2 => _2((entry) => {
      const projectId = entry.project_id;
      const project = Array.isArray(entry.projects) ? entry.projects[0] : entry.projects;

      if (!project) return;

      const existing = projectMap.get(projectId);
      if (existing) {
        existing.hours += entry.hours_logged || 0;
      } else {
        const account = Array.isArray(project.accounts) ? project.accounts[0] : project.accounts;
        projectMap.set(projectId, {
          projectId,
          projectName: project.name,
          accountName: _optionalChain([account, 'optionalAccess', _3 => _3.name]) || 'No Account',
          hours: entry.hours_logged || 0,
          color: COLORS[projectMap.size % COLORS.length],
        });
      }
    })]);

    // Convert to array and sort by hours
    const projects = Array.from(projectMap.values())
      .sort((a, b) => b.hours - a.hours)
      .map((p, i) => ({
        ...p,
        hours: Math.round(p.hours * 10) / 10,
        color: COLORS[i % COLORS.length],
      }));

    const totalHours = projects.reduce((sum, p) => sum + p.hours, 0);

    return NextResponse.json({
      success: true,
      data: {
        projects,
        totalHours: Math.round(totalHours * 10) / 10,
        weekStart: weekStartStr,
        weekEnd: weekEndStr,
      },
    });
  } catch (error) {
    logger.error('Error in GET /api/dashboard/time-by-project', {}, error );
    return NextResponse.json(
      { error: 'Internal server error', message: (error ).message },
      { status: 500 },
    );
  }
}

// CommonJS exports
exports.dynamic = dynamic;
exports.GET = GET;
