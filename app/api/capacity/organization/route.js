 function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } } function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }/**
 * API Route: Organization Capacity
 * Returns aggregated capacity data for the entire organization
 */
const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { format, subDays, subWeeks, subMonths, startOfWeek, startOfMonth, startOfQuarter, subQuarters, endOfWeek, endOfMonth, endOfQuarter,  } = require('date-fns');
const { hasPermission } = require('@/lib/permission-checker');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
// Type definitions

















// Enable route caching with stale-while-revalidate
const dynamic = 'force-dynamic';
const revalidate = 30; // Revalidate every 30 seconds
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

    const { searchParams } = new URL(request.url);
    const period = (_nullishCoalesce(searchParams.get('period'), () => ( 'weekly'))) ;

    // Permission check: VIEW_ALL_CAPACITY required for organization-wide data
    const canViewAll = await hasPermission(
      userProfile,
      Permission.VIEW_ALL_CAPACITY,
      undefined,
      admin,
    );
    if (!canViewAll) {
      return NextResponse.json(
        { error: 'Insufficient permissions to view organization capacity' },
        { status: 403 },
      );
    }

    const ranges = getDateRanges(period);
    const earliestDate = ranges[0].startDate;
    const latestDate = ranges[ranges.length - 1].endDate;

    // Get all users with availability data
    const { data: allUsers } = await supabase.from('user_profiles').select('id');

    const userIds = (allUsers || []).map((u) => u.id );

    // Fetch organization-wide data
    const [availabilityData, timeEntriesData, projectAssignmentsData, tasksData] =
      await Promise.all([
        supabase
          .from('user_availability')
          .select('user_id, week_start_date, available_hours, schedule_data')
          .in('user_id', userIds)
          .gte('week_start_date', earliestDate)
          .lte('week_start_date', latestDate),

        supabase
          .from('time_entries')
          .select('hours_logged, entry_date')
          .in('user_id', userIds)
          .gte('entry_date', earliestDate)
          .lte('entry_date', latestDate),

        supabase
          .from('project_assignments')
          .select(
            `
          user_id,
          project_id,
          projects!inner (
            id,
            estimated_hours,
            status,
            start_date,
            end_date
          )
        `,
          )
          .in('user_id', userIds)
          .is('removed_at', null),

        supabase
          .from('tasks')
          .select(
            'id, project_id, estimated_hours, remaining_hours, status, start_date, due_date, created_at, assigned_to',
          )
          .in('assigned_to', userIds),
      ]);

    // Get all project tasks
    const projectIds = Array.from(
      new Set((projectAssignmentsData.data || []).map((pa) => pa.project_id)),
    );
    let projectTasksData = null;
    if (projectIds.length > 0) {
      const { data } = await supabase
        .from('tasks')
        .select(
          'id, project_id, estimated_hours, remaining_hours, status, start_date, due_date, created_at',
        )
        .in('project_id', projectIds);
      projectTasksData = data;
    }

    // Build availability map per user per week, schedule data map, and per-user defaults
    const availabilityMap = new Map();
    const scheduleDataMap = new Map();
    const userDefaultHoursMap = new Map();
    if (availabilityData.data) {
      availabilityData.data.forEach((a) => {
        const userId = a.user_id ;
        const weekStartDate = a.week_start_date ;
        const availableHours = a.available_hours ;

        if (!availabilityMap.has(userId)) {
          availabilityMap.set(userId, new Map());
        }
        _optionalChain([availabilityMap, 'access', _ => _.get, 'call', _2 => _2(userId), 'optionalAccess', _3 => _3.set, 'call', _4 => _4(weekStartDate, availableHours)]);

        if (a.schedule_data) {
          if (!scheduleDataMap.has(userId)) {
            scheduleDataMap.set(userId, new Map());
          }
          _optionalChain([scheduleDataMap, 'access', _5 => _5.get, 'call', _6 => _6(userId), 'optionalAccess', _7 => _7.set, 'call', _8 => _8(weekStartDate, a.schedule_data )]);
        }
      });
    }

    // Build a map of project end dates for tasks to inherit when they have no due_date
    const projectEndDateMap = new Map();
    if (projectAssignmentsData.data) {
      for (const pa of projectAssignmentsData.data) {
        const project = Array.isArray(pa.projects) ? pa.projects[0] : pa.projects;
        if (project) {
          const projectId = (project ).id ;
          const endDate = (project ).end_date
            ? new Date((project ).end_date )
            : null;
          projectEndDateMap.set(projectId, endDate);
        }
      }
    }

    // Calculate capacity for each date range
    const dataPoints = ranges.map((range) => {
      const periodStart = new Date(range.startDate);
      const periodEnd = new Date(range.endDate);

      // Calculate total available hours across all users
      let totalAvailable = 0;
      userIds.forEach((userId) => {
        const userAvailability = _nullishCoalesce(availabilityMap.get(userId), () => ( new Map()));

        const defaultHours = 0; // No record = not available

        const userScheduleData = scheduleDataMap.get(userId);
        const dayNames = [
          'sunday',
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
        ];
        const allDays = [
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
          'sunday',
        ];

        if (period === 'daily') {
          const weekStart = getWeekStartDate(periodStart);
          const schedule = _optionalChain([userScheduleData, 'optionalAccess', _9 => _9.get, 'call', _10 => _10(weekStart)]);
          const dayName = dayNames[periodStart.getDay()];
          if (_optionalChain([schedule, 'optionalAccess', _11 => _11.hoursPerDay]) && schedule.hoursPerDay[dayName] !== undefined) {
            totalAvailable += Number(schedule.hoursPerDay[dayName]);
          } else {
            totalAvailable += (_nullishCoalesce(userAvailability.get(weekStart), () => ( defaultHours))) / 7;
          }
        } else if (period === 'weekly') {
          const weekStart = getWeekStartDate(periodStart);
          const schedule = _optionalChain([userScheduleData, 'optionalAccess', _12 => _12.get, 'call', _13 => _13(weekStart)]);
          if (_optionalChain([schedule, 'optionalAccess', _14 => _14.hoursPerDay])) {
            totalAvailable += allDays.reduce(
              (sum, d) => sum + (Number(schedule.hoursPerDay[d]) || 0),
              0,
            );
          } else {
            totalAvailable += _nullishCoalesce(userAvailability.get(weekStart), () => ( defaultHours));
          }
        } else {
          const currentWeek = new Date(periodStart);
          const dayOfWeek = currentWeek.getDay();
          const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
          currentWeek.setDate(currentWeek.getDate() + daysToMonday);

          while (currentWeek <= periodEnd) {
            const weekStr = format(currentWeek, 'yyyy-MM-dd');
            const schedule = _optionalChain([userScheduleData, 'optionalAccess', _15 => _15.get, 'call', _16 => _16(weekStr)]);
            let weekHours;
            if (_optionalChain([schedule, 'optionalAccess', _17 => _17.hoursPerDay])) {
              weekHours = allDays.reduce(
                (sum, d) => sum + (Number(schedule.hoursPerDay[d]) || 0),
                0,
              );
            } else {
              weekHours = _nullishCoalesce(userAvailability.get(weekStr), () => ( defaultHours));
            }
            totalAvailable += weekHours;
            currentWeek.setDate(currentWeek.getDate() + 7);
          }
        }
      });

      // Calculate allocated hours from all tasks
      const allTasks = [...(tasksData.data || []), ...(_nullishCoalesce(projectTasksData, () => ( [])))];
      const uniqueTasks = Array.from(new Map(allTasks.map((t) => [t.id, t])).values());

      // Filter to incomplete tasks only
      const incompleteTasks = uniqueTasks.filter((task) => {
        return task.status !== 'done' && task.status !== 'complete';
      });

      const now = new Date();
      let totalAllocated = incompleteTasks.reduce((sum, task) => {
        const hours = (_nullishCoalesce(_nullishCoalesce(task.remaining_hours, () => ( task.estimated_hours)), () => ( 0))) ;
        if (hours === 0) return sum;

        const taskStart = task.start_date
          ? new Date(task.start_date )
          : new Date(task.created_at );
        // IMPORTANT: If task has no due_date, inherit from parent project's end_date
        // This ensures tasks in overdue projects are correctly treated as overdue
        const taskOwnDueDate = task.due_date ? new Date(task.due_date ) : null;
        const projectEndDate = task.project_id
          ? projectEndDateMap.get(task.project_id )
          : null;
        const taskDueDate = _nullishCoalesce(taskOwnDueDate, () => ( projectEndDate));

        // CASE 1: Task is OVERDUE (due date is in the past)
        // All remaining hours should be allocated to current/future periods
        if (taskDueDate && taskDueDate < now) {
          // For overdue tasks, allocate all remaining hours to this week
          // (they need to be done NOW)
          if (periodStart <= now && periodEnd >= now) {
            // This is the current period - allocate all overdue hours here
            return sum + hours;
          } else if (periodStart > now) {
            // Future period - don't double-count overdue tasks
            return sum;
          } else {
            // Past period - don't count overdue tasks in historical data
            return sum;
          }
        }

        // CASE 2: Task has no due date - spread from now until far future
        if (!taskDueDate) {
          // No due date means indefinite - spread over a reasonable timeframe (90 days)
          const effectiveEnd = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
          const effectiveStart = taskStart > now ? taskStart : now;

          if (effectiveStart > periodEnd || effectiveEnd < periodStart) return sum;

          const durationDays = Math.max(
            1,
            Math.ceil((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)),
          );
          const dailyRate = hours / durationDays;

          const overlapStart = new Date(Math.max(effectiveStart.getTime(), periodStart.getTime()));
          const overlapEnd = new Date(Math.min(effectiveEnd.getTime(), periodEnd.getTime()));
          const overlapDays = Math.max(
            0,
            Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1,
          );

          return sum + dailyRate * overlapDays;
        }

        // CASE 3: Task has a FUTURE due date - spread hours from now until due date
        const effectiveStart = taskStart > now ? taskStart : now;

        // If task hasn't started yet and starts after this period, skip
        if (effectiveStart > periodEnd) return sum;

        // Calculate remaining duration (from now or task start, whichever is later)
        const remainingDurationMs = taskDueDate.getTime() - effectiveStart.getTime();
        const remainingDurationDays = Math.max(
          1,
          Math.ceil(remainingDurationMs / (1000 * 60 * 60 * 24)),
        );
        const dailyRate = hours / remainingDurationDays;

        const overlapStart = new Date(Math.max(effectiveStart.getTime(), periodStart.getTime()));
        const overlapEnd = new Date(Math.min(taskDueDate.getTime(), periodEnd.getTime()));
        const overlapMs = overlapEnd.getTime() - overlapStart.getTime();
        const overlapDays = Math.max(0, Math.ceil(overlapMs / (1000 * 60 * 60 * 24)) + 1);

        return sum + dailyRate * overlapDays;
      }, 0);

      // Add project-level estimates for projects with no tasks
      if (projectAssignmentsData.data) {
        const now = new Date();
        for (const pa of projectAssignmentsData.data) {
          const project = Array.isArray(pa.projects) ? pa.projects[0] : pa.projects;
          if (!project || (project ).status === 'complete') continue;

          const projectHasTasks = (_nullishCoalesce(projectTasksData, () => ( []))).some(
            (t) => t.project_id === (project ).id,
          );

          if (!projectHasTasks && (project ).estimated_hours) {
            const projectStart = (project ).start_date
              ? new Date((project ).start_date )
              : new Date();
            const projectDueDate = (project ).end_date
              ? new Date((project ).end_date )
              : null;
            const estimatedHours = (project ).estimated_hours ;

            // CASE 1: Project is OVERDUE
            if (projectDueDate && projectDueDate < now) {
              if (periodStart <= now && periodEnd >= now) {
                // Allocate all remaining hours to current period
                totalAllocated += estimatedHours;
              }
              continue;
            }

            // CASE 2: No due date - spread over 90 days from now
            if (!projectDueDate) {
              const effectiveEnd = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
              const effectiveStart = projectStart > now ? projectStart : now;

              if (effectiveStart <= periodEnd && effectiveEnd >= periodStart) {
                const durationDays = Math.max(
                  1,
                  Math.ceil(
                    (effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24),
                  ),
                );
                const dailyRate = estimatedHours / durationDays;

                const overlapStart = new Date(
                  Math.max(effectiveStart.getTime(), periodStart.getTime()),
                );
                const overlapEnd = new Date(Math.min(effectiveEnd.getTime(), periodEnd.getTime()));
                const overlapDays = Math.max(
                  0,
                  Math.ceil(
                    (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24),
                  ) + 1,
                );

                totalAllocated += dailyRate * overlapDays;
              }
              continue;
            }

            // CASE 3: Future due date - spread from now until due date
            const effectiveStart = projectStart > now ? projectStart : now;
            if (effectiveStart > periodEnd) continue;

            const remainingDurationMs = projectDueDate.getTime() - effectiveStart.getTime();
            const remainingDurationDays = Math.max(
              1,
              Math.ceil(remainingDurationMs / (1000 * 60 * 60 * 24)),
            );
            const dailyRate = estimatedHours / remainingDurationDays;

            const overlapStart = new Date(
              Math.max(effectiveStart.getTime(), periodStart.getTime()),
            );
            const overlapEnd = new Date(Math.min(projectDueDate.getTime(), periodEnd.getTime()));
            const overlapMs = overlapEnd.getTime() - overlapStart.getTime();
            const overlapDays = Math.max(0, Math.ceil(overlapMs / (1000 * 60 * 60 * 24)) + 1);

            totalAllocated += dailyRate * overlapDays;
          }
        }
      }

      // Calculate total actual hours
      const totalActual = (timeEntriesData.data || [])
        .filter((entry) => {
          const entryDate = new Date(entry.entry_date );
          return entryDate >= periodStart && entryDate <= periodEnd;
        })
        .reduce((sum, entry) => sum + ((entry.hours_logged ) || 0), 0);

      const utilization = totalAvailable > 0 ? Math.round((totalActual / totalAvailable) * 100) : 0;

      return {
        label: range.label,
        startDate: range.startDate,
        endDate: range.endDate,
        available: Math.round(totalAvailable * 10) / 10,
        allocated: Math.round(totalAllocated * 10) / 10,
        actual: Math.round(totalActual * 10) / 10,
        utilization,
      };
    });

    const response = NextResponse.json({
      success: true,
      data: dataPoints,
      period,
    });

    // Add aggressive caching headers (30 second cache, 5 minute stale-while-revalidate)
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');

    return response;
  } catch (error) {
    const err = error ;
    logger.error('Error in GET /api/capacity/organization', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function getWeekStartDate(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.getFullYear(), d.getMonth(), diff);
  return format(monday, 'yyyy-MM-dd');
}

function getDateRanges(
  period,
) {
  const ranges = [];
  const today = new Date();

  switch (period) {
    case 'daily': {
      for (let i = -7; i <= 7; i++) {
        const date = subDays(today, -i);
        const dateStr = format(date, 'yyyy-MM-dd');
        ranges.push({
          startDate: dateStr,
          endDate: dateStr,
          label: format(date, 'MMM d'),
        });
      }
      break;
    }
    case 'weekly': {
      for (let i = -4; i <= 4; i++) {
        const weekStart = startOfWeek(subWeeks(today, -i), { weekStartsOn: 1 });
        const weekEnd = endOfWeek(subWeeks(today, -i), { weekStartsOn: 1 });
        ranges.push({
          startDate: format(weekStart, 'yyyy-MM-dd'),
          endDate: format(weekEnd, 'yyyy-MM-dd'),
          label: format(weekStart, 'MMM d'),
        });
      }
      break;
    }
    case 'monthly': {
      for (let i = -3; i <= 3; i++) {
        const monthStart = startOfMonth(subMonths(today, -i));
        const monthEnd = endOfMonth(subMonths(today, -i));
        ranges.push({
          startDate: format(monthStart, 'yyyy-MM-dd'),
          endDate: format(monthEnd, 'yyyy-MM-dd'),
          label: format(monthStart, 'MMM yyyy'),
        });
      }
      break;
    }
    case 'quarterly': {
      for (let i = -2; i <= 2; i++) {
        const quarterStart = startOfQuarter(subQuarters(today, -i));
        const quarterEnd = endOfQuarter(subQuarters(today, -i));
        ranges.push({
          startDate: format(quarterStart, 'yyyy-MM-dd'),
          endDate: format(quarterEnd, 'yyyy-MM-dd'),
          label: `Q${Math.floor(quarterStart.getMonth() / 3) + 1} ${format(quarterStart, 'yyyy')}`,
        });
      }
      break;
    }
  }

  return ranges;
}

// CommonJS exports
exports.dynamic = dynamic;
exports.revalidate = revalidate;
exports.GET = GET;
