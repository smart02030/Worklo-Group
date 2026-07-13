 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { getActiveSteps, getAllActiveAndWaitingSteps, isWorkflowComplete,  } = require('@/lib/workflow-execution-service');
const { checkPermissionHybrid } = require('@/lib/permission-checker');
const { Permission } = require('@/lib/permissions');
const { verifyWorkflowInstanceAccess } = require('@/lib/access-control-server');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');
/**
 * GET /api/workflows/instances/[id]/active-steps
 * Returns all active and waiting steps for a workflow instance
 */
async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const workflowInstanceId = resolvedParams.id;
    if (!isValidUUID(workflowInstanceId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    const supabase = createApiSupabaseClient(request);

    if (!supabase) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    // Auth check - require authenticated user with profile
    const userProfile = await getUserProfileFromRequest(supabase);
    if (!userProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = { id: (userProfile ).id };
    const isSuperadmin = (userProfile ).is_superadmin === true;

    // Permission check: user needs EXECUTE_WORKFLOWS permission
    const canView = await checkPermissionHybrid(
      userProfile,
      Permission.EXECUTE_WORKFLOWS,
      undefined,
      admin,
    );
    if (!canView) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Access check: verify user has access to this workflow's project (superadmins bypass)
    if (!isSuperadmin) {
      const accessCheck = await verifyWorkflowInstanceAccess(supabase, user.id, workflowInstanceId);
      if (!accessCheck.hasAccess) {
        return NextResponse.json(
          { error: 'You do not have access to this workflow instance' },
          { status: 403 },
        );
      }
    }

    // Get active steps
    const activeSteps = await getActiveSteps(supabase, workflowInstanceId);

    // Get all steps including waiting
    const allSteps = await getAllActiveAndWaitingSteps(supabase, workflowInstanceId);

    // Check completion status
    const complete = await isWorkflowComplete(supabase, workflowInstanceId);

    // Count unique completed branches
    const { data: completedSteps } = await supabase
      .from('workflow_active_steps')
      .select('branch_id')
      .eq('workflow_instance_id', workflowInstanceId)
      .eq('status', 'completed');

    const completedBranches = new Set(
      _optionalChain([completedSteps, 'optionalAccess', _ => _.map, 'call', _2 => _2((s) => s.branch_id)]) || [],
    ).size;

    // Count waiting branches
    const waitingBranches = allSteps.filter((s) => s.status === 'waiting').length;

    // Derive hasParallelPaths from unique branch_ids in active steps
    const allBranchIds = new Set(allSteps.map((s) => s.branch_id).filter(Boolean));
    const hasParallelPaths = allBranchIds.size > 1;

    // Enrich active steps with node information (bulk fetch to avoid N+1 queries)
    const allNodeIds = [...new Set(allSteps.map((s) => s.node_id).filter(Boolean))];
    const allUserIds = [...new Set(allSteps.map((s) => s.assigned_user_id).filter(Boolean))];

    const [nodesResult, usersResult] = await Promise.all([
      allNodeIds.length > 0
        ? admin
            .from('workflow_nodes')
            .select(
              'id, label, node_type, entity_id, settings, form_template_id, position_x, position_y',
            )
            .in('id', allNodeIds)
        : { data: [] },
      allUserIds.length > 0
        ? admin.from('user_profiles').select('id, name, email').in('id', allUserIds)
        : { data: [] },
    ]);

    const nodesMap = new Map((nodesResult.data || []).map((n) => [n.id, n]));
    const usersMap = new Map((usersResult.data || []).map((u) => [u.id, u]));

    const enrichedSteps = allSteps.map((step) => ({
      ...step,
      node: nodesMap.get(step.node_id) || null,
      assignedUser: step.assigned_user_id ? usersMap.get(step.assigned_user_id) || null : null,
    }));

    return NextResponse.json({
      activeSteps: enrichedSteps.filter((s) => s.status === 'active'),
      waitingSteps: enrichedSteps.filter((s) => s.status === 'waiting'),
      allSteps: enrichedSteps,
      isComplete: complete,
      hasParallelPaths,
      completedBranches,
      waitingBranches,
      activeBranches: activeSteps.length,
    });
  } catch (error) {
    logger.error('Error fetching active steps', {}, error );
    return NextResponse.json({ error: 'Failed to fetch active steps' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
