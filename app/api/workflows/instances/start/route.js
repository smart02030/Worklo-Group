const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { startWorkflowInstance } = require('@/lib/workflow-service');
const { validateRequestBody, startWorkflowInstanceSchema } = require('@/lib/validation-schemas');
const { isAssignedToProjectServer } = require('@/lib/access-control-server');
const { logger } = require('@/lib/debug-logger');
// POST /api/workflows/instances/start - Start a workflow instance
async function POST(request) {
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

    // Check EXECUTE_WORKFLOWS permission
    const canExecute = await hasPermission(
      userProfile,
      Permission.EXECUTE_WORKFLOWS,
      undefined,
      admin,
    );
    if (!canExecute) {
      return NextResponse.json(
        { error: 'Insufficient permissions to execute workflows' },
        { status: 403 },
      );
    }

    // Validate request body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const validation = validateRequestBody(startWorkflowInstanceSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Verify user has access to the project if project_id is provided
    if (validation.data.project_id) {
      const hasAccess = await isAssignedToProjectServer(
        supabase,
        user.id,
        validation.data.project_id,
      );
      if (!hasAccess) {
        return NextResponse.json(
          {
            error: 'You do not have access to this project',
          },
          { status: 403 },
        );
      }
    }

    // Start workflow instance
    const instance = await startWorkflowInstance({
      workflowTemplateId: validation.data.workflow_template_id,
      projectId: validation.data.project_id || null,
      taskId: validation.data.task_id || null,
      startNodeId: validation.data.start_node_id,
    });

    return NextResponse.json({ success: true, instance }, { status: 201 });
  } catch (error) {
    logger.error('Error in POST /api/workflows/instances/start', {}, error );

    // Return specific messages for known validation errors, generic for others
    const errorMessage = error instanceof Error ? error.message : '';
    const isValidationError =
      errorMessage.includes('not active') ||
      errorMessage.includes('no nodes') ||
      errorMessage.includes('not found') ||
      errorMessage.includes('Invalid start node');

    return NextResponse.json(
      {
        error: isValidationError ? errorMessage : 'Internal server error',
        success: false,
      },
      { status: isValidationError ? 400 : 500 },
    );
  }
}

// CommonJS exports
exports.POST = POST;
