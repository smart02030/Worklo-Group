const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { getWorkflowHistory } = require('@/lib/workflow-service');
const { verifyWorkflowInstanceAccess } = require('@/lib/access-control-server');
const { logger } = require('@/lib/debug-logger');
// GET /api/workflows/instances/[id]/history - Get complete workflow history
async function GET(request, { params }) {
  const { id } = await params;

  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const admin = createAdminSupabaseClient();
    if (!admin) return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });

    // Get user profile with roles
    const { data: userProfile } = await admin
      .from('user_profiles')
      .select(
        `
        *,
        user_roles!user_id(
          roles!role_id(
            id,
            name,
            permissions,
            department_id
          )
        )
      `,
      )
      .eq('id', user.id)
      .single();

    if (!userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Check EXECUTE_WORKFLOWS permission (users viewing their assigned workflow history)
    const canView = await hasPermission(
      userProfile,
      Permission.EXECUTE_WORKFLOWS,
      undefined,
      admin,
    );
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions to view workflows' },
        { status: 403 },
      );
    }

    // Verify user has access to the workflow instance's project (superadmins bypass)
    if (!(userProfile ).is_superadmin) {
      const accessCheck = await verifyWorkflowInstanceAccess(supabase, user.id, id);
      if (!accessCheck.hasAccess) {
        return NextResponse.json(
          { error: 'You do not have access to this workflow instance' },
          { status: 403 },
        );
      }
    }

    // Get workflow history
    const history = await getWorkflowHistory(id);

    return NextResponse.json({ success: true, history }, { status: 200 });
  } catch (error) {
    logger.error('Error in GET /api/workflows/instances/[id]/history', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
