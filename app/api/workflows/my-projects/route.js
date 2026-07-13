const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { getUserActiveProjects } = require('@/lib/workflow-execution-service');
const { checkPermissionHybrid } = require('@/lib/permission-checker');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
/**
 * GET /api/workflows/my-projects
 * Returns active projects for the user
 * Superadmins see ALL active projects across all users
 */
async function GET(request) {
  try {
    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    // Get current user with profile
    const userProfile = await getUserProfileFromRequest(supabase);
    if (!userProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check EXECUTE_WORKFLOWS permission
    const canExecute = await checkPermissionHybrid(
      userProfile,
      Permission.EXECUTE_WORKFLOWS,
      undefined,
      admin,
    );
    if (!canExecute) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const isSuperadmin = (userProfile ).is_superadmin === true;
    const user = { id: (userProfile ).id };

    let projects = [];

    if (isSuperadmin) {
      // Superadmins see ALL active projects with their assigned users
      const { data: allAssignments } = await supabase
        .from('project_assignments')
        .select(
          `
          *,
          projects!inner(
            id,
            name,
            description,
            status,
            priority,
            created_at,
            account_id,
            estimated_hours,
            actual_hours,
            end_date,
            start_date,
            accounts(id, name)
          ),
          user_profiles(
            id,
            name,
            email
          )
        `,
        )
        .is('removed_at', null);

      // Filter out completed projects and add assigned_user info
      projects = (allAssignments || [])
        .filter((p) => {
          const projects = p.projects ;
          const project = Array.isArray(projects) ? projects[0] : projects;
          return project && (project.status ) !== 'complete';
        })
        .map((p) => {
          const userProfiles = p.user_profiles ;
          return {
            ...p,
            assigned_user: userProfiles
              ? {
                  id: userProfiles.id,
                  name: userProfiles.name,
                  email: userProfiles.email,
                }
              : undefined,
          };
        });
    } else {
      // Regular users see only their assigned active projects
      projects = await getUserActiveProjects(supabase, user.id);
    }

    return NextResponse.json({
      success: true,
      projects,
    });
  } catch (error) {
    logger.error('Error in GET /api/workflows/my-projects', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
