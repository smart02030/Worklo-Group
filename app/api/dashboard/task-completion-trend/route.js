/**
 * API Route: Task Completion Trend
 * Returns task completion data for the past 4 weeks
 */
const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { startOfWeek, endOfWeek, subWeeks, format } = require('date-fns');
const { logger } = require('@/lib/debug-logger');
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
    const weeks = [];

    // Get data for the past 4 weeks
    for (let i = 3; i >= 0; i--) {
      const weekDate = subWeeks(now, i);
      const weekStart = startOfWeek(weekDate, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(weekDate, { weekStartsOn: 1 });
      const weekStartStr = format(weekStart, 'yyyy-MM-dd');
      const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

      // Count tasks completed this week (assigned to user)
      const { count: completedCount } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('assigned_to', userId)
        .eq('status', 'done')
        .gte('updated_at', weekStartStr)
        .lte('updated_at', weekEndStr + 'T23:59:59');

      // Count tasks created this week (assigned to user)
      const { count: createdCount } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('assigned_to', userId)
        .gte('created_at', weekStartStr)
        .lte('created_at', weekEndStr + 'T23:59:59');

      weeks.push({
        weekStart: weekStartStr,
        weekLabel: format(weekStart, 'MMM d'),
        completed: completedCount || 0,
        created: createdCount || 0,
      });
    }

    // Calculate totals
    const totalCompleted = weeks.reduce((sum, w) => sum + w.completed, 0);
    const totalCreated = weeks.reduce((sum, w) => sum + w.created, 0);

    return NextResponse.json({
      success: true,
      data: {
        weeks,
        totalCompleted,
        totalCreated,
        completionRate: totalCreated > 0 ? Math.round((totalCompleted / totalCreated) * 100) : 0,
      },
    });
  } catch (error) {
    logger.error('Error in GET /api/dashboard/task-completion-trend', {}, error );
    return NextResponse.json(
      { error: 'Internal server error', message: (error ).message },
      { status: 500 },
    );
  }
}

// CommonJS exports
exports.dynamic = dynamic;
exports.GET = GET;
