 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { getWorkflowTemplateById, updateWorkflowTemplate, deleteWorkflowTemplate,  } = require('@/lib/workflow-service');
const { validateRequestBody, updateWorkflowTemplateSchema } = require('@/lib/validation-schemas');
const { checkDemoModeForDestructiveAction } = require('@/lib/api-demo-guard');
const { logger } = require('@/lib/debug-logger');
// Type definitions
// GET /api/admin/workflows/templates/[id] - Get workflow template with nodes and connections
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
          role_id,
          roles!role_id(
            id,
            name,
            permissions,
            department_id,
            is_system_role
          )
        )
      `,
      )
      .eq('id', user.id)
      .single();

    if (!userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Check VIEW_WORKFLOWS permission (pass supabase client for server context)
    const canView = await hasPermission(userProfile, Permission.MANAGE_WORKFLOWS, undefined, admin);
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions to view workflows' },
        { status: 403 },
      );
    }

    // Get template with nodes and connections
    const template = await getWorkflowTemplateById(id);

    if (!template) {
      return NextResponse.json({ error: 'Workflow template not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, template }, { status: 200 });
  } catch (error) {
    logger.error('Error in GET /api/admin/workflows/templates/[id]', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/admin/workflows/templates/[id] - Update workflow template
async function PATCH(request, { params }) {
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
          role_id,
          roles!role_id(
            id,
            name,
            permissions,
            department_id,
            is_system_role
          )
        )
      `,
      )
      .eq('id', user.id)
      .single();

    if (!userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Check MANAGE_WORKFLOWS permission (pass supabase client for server context)
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
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const validation = validateRequestBody(updateWorkflowTemplateSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // If activating the workflow, validate that all roles have users assigned
    if (validation.data.is_active === true) {
      // Get workflow nodes
      const { data: nodes } = await admin
        .from('workflow_nodes')
        .select('id, node_type, entity_id, label')
        .eq('workflow_template_id', id);

      if (nodes && nodes.length > 0) {
        // Get role IDs from role and approval nodes
        const roleIds = nodes
          .filter((n) => (n.node_type === 'role' || n.node_type === 'approval') && n.entity_id)
          .map((n) => n.entity_id);

        if (roleIds.length > 0) {
          // Get roles with user counts
          const { data: roles } = await admin
            .from('roles')
            .select(
              `
              id,
              name,
              user_roles!user_id(count)
            `,
            )
            .in('id', roleIds);

          // Check for roles with no users
          const emptyRoles = (roles || []).filter((r) => {
            const count = _optionalChain([r, 'access', _ => _.user_roles, 'optionalAccess', _2 => _2[0], 'optionalAccess', _3 => _3.count]) || 0;
            return count === 0;
          });

          if (emptyRoles.length > 0) {
            const nodeLabels = nodes
              .filter((n) => emptyRoles.some((r) => r.id === n.entity_id))
              .map((n) => `"${n.label}"`)
              .join(', ');

            const roleNames = emptyRoles.map((r) => `"${r.name}"`).join(', ');

            return NextResponse.json(
              {
                error: `Cannot activate workflow: ${emptyRoles.length === 1 ? 'Role' : 'Roles'} ${roleNames} ${emptyRoles.length === 1 ? 'has' : 'have'} no users assigned. Affected nodes: ${nodeLabels}. Please assign users to these roles first.`,
              },
              { status: 400 },
            );
          }
        }
      } else {
        // No nodes - cannot activate
        return NextResponse.json(
          {
            error:
              'Cannot activate workflow: No nodes configured. Please add at least a Start and End node.',
          },
          { status: 400 },
        );
      }
    }

    // Update template
    const updates = {
      ...validation.data,
      description: validation.data.description === null ? undefined : validation.data.description,
    };
    const template = await updateWorkflowTemplate(id, updates, admin);

    if (!template) {
      return NextResponse.json({ error: 'Workflow template not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, template }, { status: 200 });
  } catch (error) {
    logger.error('Error in PATCH /api/admin/workflows/templates/[id]', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/admin/workflows/templates/[id] - Permanently delete workflow template
async function DELETE(
  request,
  { params },
) {
  const { id } = await params;

  try {
    // Block in demo mode
    const blocked = checkDemoModeForDestructiveAction('delete_workflow');
    if (blocked) return blocked;

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
          role_id,
          roles!role_id(
            id,
            name,
            permissions,
            department_id,
            is_system_role
          )
        )
      `,
      )
      .eq('id', user.id)
      .single();

    if (!userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Check MANAGE_WORKFLOWS permission (pass supabase client for server context)
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

    // Permanently delete template and all associated nodes/connections
    // NOTE: In-progress workflows will continue to work - they have their own snapshots
    await deleteWorkflowTemplate(id, admin);

    return NextResponse.json(
      {
        success: true,
        message:
          'Workflow template deleted successfully. Existing projects will continue using their workflow snapshots.',
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error('Error in DELETE /api/admin/workflows/templates/[id]', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
exports.PATCH = PATCH;
exports.DELETE = DELETE;
