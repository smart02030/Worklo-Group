 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient } = require('@/lib/supabase-server');
const { requireAuthentication, handleGuardError } = require('@/lib/server-guards');
const { hasPermission } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
async function GET(request) {
  try {
    // Check authentication - return empty array if not authenticated instead of throwing
    let userProfile;
    try {
      userProfile = await requireAuthentication(request);
    } catch (_error) {
      logger.debug('User not authenticated, returning empty project updates', {
        action: 'getProjectUpdates',
      });
      return NextResponse.json([]);
    }

    if (!userProfile) {
      logger.debug('User profile is null, returning empty project updates', {
        action: 'getProjectUpdates',
      });
      return NextResponse.json([]);
    }

    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      logger.error('Supabase not configured', { action: 'getProjectUpdates' });
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const userId = userProfile.id;

    // Phase 10: Use project access pattern instead of deprecated VIEW_UPDATES/VIEW_ALL_UPDATES
    // Superadmins and users with VIEW_ALL_PROJECTS see all updates; others see updates for accessible projects
    const isSuperadmin = userProfile.is_superadmin;
    const hasViewAll =
      !isSuperadmin &&
      (await hasPermission(userProfile, Permission.VIEW_ALL_PROJECTS, undefined, admin));

    // Build query
    let query = supabase.from('project_updates').select(`
        id,
        project_id,
        content,
        created_by,
        workflow_history_id,
        created_at,
        updated_at,
        user_profiles:created_by(id, name, email, image),
        projects:project_id(
          id,
          name,
          status,
          priority,
          accounts:account_id(id, name)
        )
      `);

    // Superadmins and VIEW_ALL_PROJECTS users see all updates
    if (isSuperadmin || hasViewAll) {
      logger.debug('User has global project access, returning all updates', { userId });
    } else {
      // Filter to projects user has access to (same logic as userHasProjectAccess)
      logger.debug('Filtering project updates to accessible projects', { userId });

      const [{ data: assignedProjects }, { data: directProjects }, { data: accountProjects }] =
        await Promise.all([
          supabase
            .from('project_assignments')
            .select('project_id')
            .eq('user_id', userId)
            .is('removed_at', null),
          supabase
            .from('projects')
            .select('id')
            .or(`created_by.eq.${userId},assigned_user_id.eq.${userId}`),
          supabase
            .from('account_members')
            .select('account:accounts!inner(projects(id))')
            .eq('user_id', userId),
        ]);

      const projectIds = new Set();
      _optionalChain([assignedProjects, 'optionalAccess', _ => _.forEach, 'call', _2 => _2((ap) => projectIds.add(ap.project_id))]);
      _optionalChain([directProjects, 'optionalAccess', _3 => _3.forEach, 'call', _4 => _4((p) => projectIds.add(p.id))]);
      _optionalChain([(
        accountProjects 
      ), 'optionalAccess', _5 => _5.forEach, 'call', _6 => _6((am) => {
        _optionalChain([am, 'access', _7 => _7.account, 'optionalAccess', _8 => _8.projects, 'optionalAccess', _9 => _9.forEach, 'call', _10 => _10((p) => projectIds.add(p.id))]);
      })]);

      if (projectIds.size > 0) {
        query = query.in('project_id', Array.from(projectIds));
      } else {
        query = query.eq('project_id', '00000000-0000-0000-0000-000000000000');
      }
    }

    // Execute query
    const { data, error } = await query.order('created_at', { ascending: false }).limit(50);

    if (error) {
      logger.error(
        'Error fetching project updates',
        {
          action: 'getProjectUpdates',
          userId,
          errorMessage: error.message,
          errorCode: error.code,
          errorDetails: error.details,
        },
        error,
      );
      return NextResponse.json(
        {
          error: 'Failed to fetch project updates',
        },
        { status: 500 },
      );
    }

    return NextResponse.json(data || []);
  } catch (error) {
    logger.error(
      'Unexpected error in project-updates API',
      {
        action: 'getProjectUpdates',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      error instanceof Error ? error : new Error(String(error)),
    );
    return handleGuardError(error);
  }
}

// CommonJS exports
exports.GET = GET;
