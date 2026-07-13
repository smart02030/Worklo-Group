 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }/**
 * API Route: Recent Activity
 * Returns recent activity items for the user (tasks, time entries, project updates)
 */
const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { formatDistanceToNow } = require('date-fns');
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
    const activities = [];

    // Get recent completed tasks (last 7 days)
    const { data: completedTasks } = await supabase
      .from('tasks')
      .select(
        `
        id,
        name,
        updated_at,
        project_id,
        projects(id, name)
      `,
      )
      .eq('assigned_to', userId)
      .eq('status', 'done')
      .order('updated_at', { ascending: false })
      .limit(5);

    _optionalChain([completedTasks, 'optionalAccess', _ => _.forEach, 'call', _2 => _2((task) => {
      const project = Array.isArray(task.projects) ? task.projects[0] : task.projects;
      activities.push({
        id: `task-completed-${task.id}`,
        type: 'task_completed',
        title: 'Completed task',
        description: task.name,
        timestamp: task.updated_at,
        timeAgo: formatDistanceToNow(new Date(task.updated_at), { addSuffix: true }),
        projectName: _optionalChain([project, 'optionalAccess', _3 => _3.name]),
        projectId: task.project_id,
      });
    })]);

    // Get recent time entries (last 7 days)
    const { data: timeEntries } = await supabase
      .from('time_entries')
      .select(
        `
        id,
        hours_logged,
        entry_date,
        created_at,
        project_id,
        task_id,
        projects(id, name),
        tasks(id, name)
      `,
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    _optionalChain([timeEntries, 'optionalAccess', _4 => _4.forEach, 'call', _5 => _5((entry) => {
      const project = Array.isArray(entry.projects) ? entry.projects[0] : entry.projects;
      const task = Array.isArray(entry.tasks) ? entry.tasks[0] : entry.tasks;
      activities.push({
        id: `time-${entry.id}`,
        type: 'time_logged',
        title: `Logged ${entry.hours_logged}h`,
        description: _optionalChain([task, 'optionalAccess', _6 => _6.name]) || _optionalChain([project, 'optionalAccess', _7 => _7.name]) || 'Time entry',
        timestamp: entry.created_at,
        timeAgo: formatDistanceToNow(new Date(entry.created_at), { addSuffix: true }),
        projectName: _optionalChain([project, 'optionalAccess', _8 => _8.name]),
        projectId: entry.project_id,
        metadata: {
          hours: entry.hours_logged,
          date: entry.entry_date,
        },
      });
    })]);

    // Get recent project updates from user's projects
    const { data: projectUpdates } = await supabase
      .from('project_updates')
      .select(
        `
        id,
        content,
        created_at,
        project_id,
        projects(id, name)
      `,
      )
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .limit(3);

    _optionalChain([projectUpdates, 'optionalAccess', _9 => _9.forEach, 'call', _10 => _10((update) => {
      const project = Array.isArray(update.projects) ? update.projects[0] : update.projects;
      activities.push({
        id: `update-${update.id}`,
        type: 'project_update',
        title: 'Posted update',
        description: update.content.slice(0, 100) + (update.content.length > 100 ? '...' : ''),
        timestamp: update.created_at,
        timeAgo: formatDistanceToNow(new Date(update.created_at), { addSuffix: true }),
        projectName: _optionalChain([project, 'optionalAccess', _11 => _11.name]),
        projectId: update.project_id,
      });
    })]);

    // Get recently created tasks assigned to user
    const { data: newTasks } = await supabase
      .from('tasks')
      .select(
        `
        id,
        name,
        created_at,
        project_id,
        projects(id, name)
      `,
      )
      .eq('assigned_to', userId)
      .not('status', 'eq', 'done')
      .order('created_at', { ascending: false })
      .limit(3);

    _optionalChain([newTasks, 'optionalAccess', _12 => _12.forEach, 'call', _13 => _13((task) => {
      const project = Array.isArray(task.projects) ? task.projects[0] : task.projects;
      activities.push({
        id: `task-created-${task.id}`,
        type: 'task_assigned',
        title: 'New task assigned',
        description: task.name,
        timestamp: task.created_at,
        timeAgo: formatDistanceToNow(new Date(task.created_at), { addSuffix: true }),
        projectName: _optionalChain([project, 'optionalAccess', _14 => _14.name]),
        projectId: task.project_id,
      });
    })]);

    // Sort all activities by timestamp
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Take top 10
    const recentActivities = activities.slice(0, 10);

    return NextResponse.json({
      success: true,
      data: {
        activities: recentActivities,
        totalCount: recentActivities.length,
      },
    });
  } catch (error) {
    logger.error('Error in GET /api/dashboard/recent-activity', {}, error );
    return NextResponse.json(
      { error: 'Internal server error', message: (error ).message },
      { status: 500 },
    );
  }
}

// CommonJS exports
exports.dynamic = dynamic;
exports.GET = GET;
