const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { updateWorkflowNode, deleteWorkflowNode } = require('@/lib/workflow-service');
const { validateRequestBody, updateWorkflowNodeSchema } = require('@/lib/validation-schemas');
const { logger } = require('@/lib/debug-logger');
// PATCH /api/admin/workflows/nodes/[nodeId] - Update workflow node
async function PATCH(
  request,
  { params },
) {
  const { nodeId } = await params;

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

    // Validate request body
    const body = await request.json();
    const validation = validateRequestBody(updateWorkflowNodeSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Update node
    const node = await updateWorkflowNode(nodeId, validation.data);

    if (!node) {
      return NextResponse.json({ error: 'Workflow node not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, node }, { status: 200 });
  } catch (error) {
    logger.error('Error in PATCH /api/admin/workflows/nodes/[nodeId]', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/admin/workflows/nodes/[nodeId] - Delete workflow node
async function DELETE(
  request,
  { params },
) {
  const { nodeId } = await params;

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

    // Delete node
    await deleteWorkflowNode(nodeId);

    return NextResponse.json(
      { success: true, message: 'Workflow node deleted successfully' },
      { status: 200 },
    );
  } catch (error) {
    logger.error('Error in DELETE /api/admin/workflows/nodes/[nodeId]', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.PATCH = PATCH;
exports.DELETE = DELETE;
