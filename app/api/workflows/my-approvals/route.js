 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { getUserPendingApprovals } = require('@/lib/workflow-execution-service');
const { checkPermissionHybrid } = require('@/lib/permission-checker');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
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

    let approvals = [];

    if (isSuperadmin) {
      // Superadmins see ALL pending approvals across all users
      // Query workflow_active_steps to support parallel workflows
      // IMPORTANT: Use left join for workflow_nodes so deleted templates don't break the query
      // Query without workflow_nodes FK join - use snapshot data instead
      // The FK workflow_active_steps_node_id_fkey may not exist if node was deleted after workflow started
      // Use explicit FK names to avoid "multiple relationships" errors
      const { data: activeSteps, error } = await supabase
        .from('workflow_active_steps')
        .select(
          `
          id,
          workflow_instance_id,
          node_id,
          status,
          activated_at,
          assigned_user_id,
          workflow_instances:workflow_active_steps_workflow_instance_id_fkey!inner(
            id,
            status,
            project_id,
            workflow_template_id,
            current_node_id,
            started_snapshot,
            projects:workflow_instances_project_id_fkey!inner(
              id,
              name,
              description,
              status,
              priority,
              account_id,
              accounts(id, name)
            )
          ),
          assigned_user:user_profiles(
            id,
            name,
            email
          )
        `,
        )
        .eq('status', 'active');

      if (error) {
        logger.error('[my-approvals] Error querying active steps', {}, error );
      }

      if (!error && activeSteps) {
        // Filter to only approval nodes in active workflow instances
        const filteredSteps = activeSteps.filter((step) => {
          const instance = step.workflow_instances ;
          if (!instance) return false;
          if ((instance.status ) !== 'active') return false;

          // Get node data from snapshot (we removed the FK join because it may not exist)
          const snapshot = instance.started_snapshot ;
          const nodes = _optionalChain([snapshot, 'optionalAccess', _ => _.nodes]) ;
          const node = _optionalChain([nodes, 'optionalAccess', _2 => _2.find, 'call', _3 => _3((n) => n.id === step.node_id)]);

          if (!node) {
            logger.warn('[my-approvals] Node not found in snapshot', {
              stepId: step.id,
              nodeId: step.node_id,
            });
            return false;
          }
          return (node.node_type ) === 'approval';
        });

        // Transform to match expected format
        approvals = filteredSteps.map((step) => {
          // Get node data from snapshot
          const instance = step.workflow_instances ;
          const snapshot = instance.started_snapshot ;
          const nodes = _optionalChain([snapshot, 'optionalAccess', _4 => _4.nodes]) ;
          const nodeData = _optionalChain([nodes, 'optionalAccess', _5 => _5.find, 'call', _6 => _6((n) => n.id === step.node_id)]);

          return {
            ...instance,
            workflow_nodes: nodeData,
            projects: instance.projects,
            active_step_id: step.id,
            current_node_id: step.node_id,
            assigned_user: step.assigned_user || null,
          };
        });
      }
    } else {
      // Regular users see only their pending approvals based on role
      approvals = await getUserPendingApprovals(supabase, user.id);
    }

    return NextResponse.json({
      success: true,
      approvals,
    });
  } catch (error) {
    logger.error('Error in GET /api/workflows/my-approvals', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
