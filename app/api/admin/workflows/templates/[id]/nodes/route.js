const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { createWorkflowNode } = require('@/lib/workflow-service');
const { validateRequestBody, createWorkflowNodeSchema } = require('@/lib/validation-schemas');
const { logger } = require('@/lib/debug-logger');
// POST /api/admin/workflows/templates/[id]/nodes - Create workflow node
async function POST(request, { params }) {
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
    const validation = validateRequestBody(createWorkflowNodeSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Create node
    const node = await createWorkflowNode(id, validation.data);

    return NextResponse.json({ success: true, node }, { status: 201 });
  } catch (error) {
    logger.error('Error in POST /api/admin/workflows/templates/[id]/nodes', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.POST = POST;
