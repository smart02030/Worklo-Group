const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { deleteWorkflowConnection } = require('@/lib/workflow-service');
const { logger } = require('@/lib/debug-logger');
// DELETE /api/admin/workflows/connections/[connectionId] - Delete workflow connection
async function DELETE(
  request,
  { params },
) {
  const { connectionId } = await params;

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

    // Check MANAGE_WORKFLOWS permission
    const canManage = await hasPermission(
      userProfile,
      Permission.MANAGE_WORKFLOWS,
      undefined,
      admin,
    );
    if (!canManage) {
      return NextResponse.json(
        { error: 'Insufficient permissions to manage workflows' },
        { status: 403 },
      );
    }

    // Delete connection
    await deleteWorkflowConnection(connectionId);

    return NextResponse.json(
      { success: true, message: 'Workflow connection deleted successfully' },
      { status: 200 },
    );
  } catch (error) {
    logger.error(
      'Error in DELETE /api/admin/workflows/connections/[connectionId]',
      {},
      error ,
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.DELETE = DELETE;
