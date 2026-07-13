const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { getNextAvailableNodes } = require('@/lib/workflow-service');
const { verifyWorkflowInstanceAccess } = require('@/lib/access-control-server');
const { logger } = require('@/lib/debug-logger');
// GET /api/workflows/instances/[id]/next-nodes - Get available next nodes
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

    // Check EXECUTE_WORKFLOWS permission (users who can execute workflows need to see next nodes)
    const canView = await hasPermission(
      userProfile,
      Permission.EXECUTE_WORKFLOWS,
      undefined,
      admin,
    );
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions to view workflow nodes' },
        { status: 403 },
      );
    }

    // Verify user has access to the workflow instance's project
    const accessCheck = await verifyWorkflowInstanceAccess(supabase, user.id, id);
    if (!accessCheck.hasAccess) {
      return NextResponse.json(
        {
          error: accessCheck.error || 'You do not have access to this workflow instance',
        },
        { status: 403 },
      );
    }

    // Get next available nodes
    const nextNodes = await getNextAvailableNodes(id);

    return NextResponse.json({ success: true, next_nodes: nextNodes }, { status: 200 });
  } catch (error) {
    logger.error('Error in GET /api/workflows/instances/[id]/next-nodes', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
