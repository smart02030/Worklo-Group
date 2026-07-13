const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { startWorkflowForProject } = require('@/lib/workflow-execution-service');
const { hasPermission } = require('@/lib/permission-checker');
const { Permission } = require('@/lib/permissions');
const { userHasProjectAccess } = require('@/lib/rbac');
const { logger } = require('@/lib/debug-logger');
async function POST(request) {
  try {
    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    // Get current user
    const userProfile = await getUserProfileFromRequest(supabase);
    if (!userProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch (e2) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { projectId, workflowTemplateId } = body;

    if (!projectId || !workflowTemplateId) {
      return NextResponse.json(
        { error: 'Missing required fields: projectId and workflowTemplateId' },
        { status: 400 },
      );
    }

    // Permission check: user needs EXECUTE_WORKFLOWS permission
    const canExecute = await hasPermission(
      userProfile,
      Permission.EXECUTE_WORKFLOWS,
      undefined,
      admin,
    );
    if (!canExecute) {
      return NextResponse.json(
        { error: 'Insufficient permissions to start workflows' },
        { status: 403 },
      );
    }

    // Access check: user must have access to the project
    const hasAccess = await userHasProjectAccess(userProfile, projectId, admin);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'You do not have access to this project' },
        { status: 403 },
      );
    }

    // Start the workflow
    const result = await startWorkflowForProject(
      supabase,
      projectId,
      workflowTemplateId,
      userProfile.id,
    );

    if (!result.success) {
      const notFoundErrors = ['Workflow template not found', 'Project not found'];
      const conflictErrors = ['already has an active workflow', 'already has a workflow'];
      const errorMsg = result.error || 'Failed to start workflow';

      if (notFoundErrors.some((e) => errorMsg.includes(e))) {
        return NextResponse.json({ error: errorMsg }, { status: 404 });
      }
      if (conflictErrors.some((e) => errorMsg.includes(e))) {
        return NextResponse.json({ error: errorMsg }, { status: 409 });
      }
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      workflowInstanceId: result.workflowInstanceId,
    });
  } catch (error) {
    logger.error('Error in POST /api/workflows/start', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.POST = POST;
