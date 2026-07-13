const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { handoffWorkflow } = require('@/lib/workflow-service');
const { validateRequestBody, workflowHandoffSchema } = require('@/lib/validation-schemas');
const { verifyWorkflowInstanceAccess } = require('@/lib/access-control-server');
const { logger } = require('@/lib/debug-logger');
// POST /api/workflows/instances/[id]/handoff - Hand off work to next node
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

    // Check EXECUTE_WORKFLOWS permission with workflow instance context
    // This checks both base permission AND workflow node assignment
    // Users with EXECUTE_ANY_WORKFLOW override can bypass node assignment check
    const canExecute = await hasPermission(
      userProfile,
      Permission.EXECUTE_WORKFLOWS,
      { workflowInstanceId: id },
      admin,
    );
    if (!canExecute) {
      return NextResponse.json(
        {
          error:
            'Insufficient permissions to execute this workflow. You must be assigned to the current workflow node.',
        },
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
    const validation = validateRequestBody(workflowHandoffSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
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

    // Check if out-of-order handoff requires special permission
    if (validation.data.out_of_order) {
      const canSkip = await hasPermission(
        userProfile,
        Permission.SKIP_WORKFLOW_NODES,
        undefined,
        admin,
      );
      if (!canSkip) {
        return NextResponse.json(
          {
            error: 'Insufficient permissions for out-of-order handoffs.',
          },
          { status: 403 },
        );
      }
    }

    // Execute handoff
    const historyEntry = await handoffWorkflow(supabase, {
      instanceId: id,
      toNodeId: validation.data.to_node_id,
      handedOffBy: user.id,
      handedOffTo: validation.data.handed_off_to || null,
      formResponseId: validation.data.form_response_id || null,
      notes: validation.data.notes || null,
      outOfOrder: validation.data.out_of_order || false,
    });

    return NextResponse.json({ success: true, history_entry: historyEntry }, { status: 201 });
  } catch (error) {
    logger.error('Error in POST /api/workflows/instances/[id]/handoff', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.POST = POST;
