 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }/**
 * API Route: Admin Time Entries
 * GET - Get all time entries for admin view
 */
const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/permission-checker');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
// Type definitions





/**
 * GET /api/admin/time-entries
 * Get all time entries for admin dashboard
 * Query params: startDate, endDate, userId
 */
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

    // Check for admin permission
    // Phase 9: VIEW_TEAM_TIME_ENTRIES → VIEW_ALL_TIME_ENTRIES
    const canViewTeam = await hasPermission(
      userProfile,
      Permission.VIEW_ALL_TIME_ENTRIES,
      undefined,
      admin,
    );
    if (!canViewTeam) {
      return NextResponse.json(
        { error: 'Insufficient permissions to view team time entries' },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const userId = searchParams.get('userId');

    // Build query
    let query = supabase
      .from('time_entries')
      .select(
        `
        *,
        user:user_profiles!user_id (
          id,
          name,
          email
        ),
        project:projects!project_id (
          id,
          name
        ),
        task:tasks!task_id (
          id,
          name
        )
      `,
      )
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false });

    // Apply filters
    if (startDate) {
      query = query.gte('entry_date', startDate);
    }
    if (endDate) {
      query = query.lte('entry_date', endDate);
    }
    if (userId) {
      query = query.eq('user_id', userId);
    }

    // Default to last 30 days if no date range specified
    if (!startDate && !endDate) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      query = query.gte('entry_date', thirtyDaysAgo.toISOString().split('T')[0]);
    }

    const { data: timeEntries, error } = await query;

    if (error) {
      logger.error('Error fetching time entries', {}, error );
      return NextResponse.json({ error: 'Failed to fetch time entries' }, { status: 500 });
    }

    // Calculate summary stats
    const totalHours = _optionalChain([timeEntries, 'optionalAccess', _ => _.reduce, 'call', _2 => _2((sum, entry) => sum + (entry.hours_logged || 0), 0)]) || 0;
    const uniqueUsers = new Set(_optionalChain([timeEntries, 'optionalAccess', _3 => _3.map, 'call', _4 => _4((e) => e.user_id)])).size;
    const uniqueProjects = new Set(_optionalChain([timeEntries, 'optionalAccess', _5 => _5.map, 'call', _6 => _6((e) => e.project_id)])).size;
    const autoClockOuts = _optionalChain([timeEntries, 'optionalAccess', _7 => _7.filter, 'call', _8 => _8((e) => e.is_auto_clock_out), 'access', _9 => _9.length]) || 0;

    return NextResponse.json({
      success: true,
      timeEntries: timeEntries || [],
      summary: {
        totalEntries: _optionalChain([timeEntries, 'optionalAccess', _10 => _10.length]) || 0,
        totalHours: Math.round(totalHours * 100) / 100,
        uniqueUsers,
        uniqueProjects,
        autoClockOuts,
      },
    });
  } catch (error) {
    const err = error ;
    logger.error('Error in GET /api/admin/time-entries', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
