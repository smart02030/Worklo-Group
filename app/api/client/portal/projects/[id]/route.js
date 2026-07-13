 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { getClientProjectById } = require('@/lib/client-portal-service');
const { logger } = require('@/lib/debug-logger');
// GET /api/client/portal/projects/[id] - Get project details with workflow status, team, updates
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

    // Phase 9: Client permissions are hardcoded - verify user is a client with account access
    if (!userProfile.is_client || !userProfile.client_account_id) {
      return NextResponse.json({ error: 'Client access required' }, { status: 403 });
    }

    // Get project details
    const project = await getClientProjectById(user.id, id);

    if (!project) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 });
    }

    // Fetch additional data in parallel using the authenticated client's supabase
    // (NOT createServerSupabase which may lack the client user's RLS context)
    const db = supabase;

    const [teamResult, updatesResult, workflowNodesResult, workflowHistoryResult] =
      await Promise.all([
        // Team members: project assignments with user profile info
        db
          .from('project_assignments')
          .select('id, role_in_project, user_profiles(id, name, email, image)')
          .eq('project_id', id)
          .is('removed_at', null),

        // Project updates (read-only timeline)
        db
          .from('project_updates')
          .select('id, content, created_at, user_profiles(id, name)')
          .eq('project_id', id)
          .order('created_at', { ascending: false })
          .limit(50),

        // All workflow nodes for the template (for the step visualization)
        _optionalChain([project, 'access', _ => _.workflow_instance, 'optionalAccess', _2 => _2.workflow_templates, 'optionalAccess', _3 => _3.id])
          ? db
              .from('workflow_nodes')
              .select('id, node_type, label, position_x, position_y')
              .eq('workflow_template_id', project.workflow_instance.workflow_templates.id)
              .order('position_x', { ascending: true })
          : Promise.resolve({ data: null, error: null }),

        // Workflow history (to determine completed node IDs)
        _optionalChain([project, 'access', _4 => _4.workflow_instance, 'optionalAccess', _5 => _5.id])
          ? db
              .from('workflow_history')
              .select('id, from_node_id, to_node_id, created_at, transition_type')
              .eq('workflow_instance_id', project.workflow_instance.id)
              .order('created_at', { ascending: true })
          : Promise.resolve({ data: null, error: null }),
      ]);

    // Compute completed node IDs from workflow history
    const completedNodeIds = [];
    if (workflowHistoryResult.data && workflowHistoryResult.data.length > 0) {
      const seen = new Set();
      for (const h of workflowHistoryResult.data) {
        if (h.from_node_id) seen.add(h.from_node_id);
      }
      completedNodeIds.push(...Array.from(seen));
    }

    // Normalize team data (Supabase may return user_profiles as array or object)
    const team = (teamResult.data || []).map((a) => {
      const profile = Array.isArray(a.user_profiles) ? a.user_profiles[0] : a.user_profiles;
      return {
        id: a.id,
        role_in_project: a.role_in_project,
        user: profile || null,
      };
    });

    // Normalize updates data
    const updates = (updatesResult.data || []).map((u) => {
      const author = Array.isArray(u.user_profiles) ? u.user_profiles[0] : u.user_profiles;
      return {
        id: u.id,
        content: u.content,
        created_at: u.created_at,
        author: author || null,
      };
    });

    return NextResponse.json(
      {
        success: true,
        project,
        team,
        updates,
        workflow_nodes: workflowNodesResult.data || [],
        completed_node_ids: completedNodeIds,
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error('Error in GET /api/client/portal/projects/[id]', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
