 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
// Node types that are allowed to have multiple outgoing edges
const BRANCHING_NODE_TYPES = ['approval', 'conditional'];

// PUT /api/admin/workflows/templates/[id]/steps - Save all nodes and edges for a workflow
async function PUT(request, { params }) {
  const { id: templateId } = await params;

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

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      logger.error('Error parsing request body', {}, parseError );
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    const { nodes, edges } = body;

    // Debug logging
    logger.debug('[Workflow Save] Starting save for template', { templateId });
    logger.debug('[Workflow Save] Received nodes', { count: _optionalChain([nodes, 'optionalAccess', _ => _.length]) || 0 });
    logger.debug('[Workflow Save] Received edges', { count: _optionalChain([edges, 'optionalAccess', _2 => _2.length]) || 0 });

    if (!nodes || !Array.isArray(nodes)) {
      return NextResponse.json({ error: 'Invalid nodes data - must be an array' }, { status: 400 });
    }

    // Validate node IDs are valid UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const node of nodes) {
      if (!node.id || !uuidRegex.test(node.id)) {
        logger.error('[Workflow Save] Invalid node ID format', { nodeId: node.id });
        return NextResponse.json(
          {
            error: `Invalid node ID format: "${node.id}"`,
            details:
              'Node IDs must be valid UUIDs. Please try deleting and re-creating the workflow nodes.',
          },
          { status: 400 },
        );
      }
    }

    // Server-side validation: Check for sync nodes (parallel workflows disabled)
    const syncNodes = nodes.filter((n) => {
      const data = n.data ;
      return _optionalChain([data, 'optionalAccess', _3 => _3.type]) === 'sync';
    });
    if (syncNodes.length > 0) {
      return NextResponse.json(
        {
          error: 'Sync nodes are not allowed. Parallel workflows have been disabled.',
          details: `Found ${syncNodes.length} sync node(s). Please remove them and use a single pathway.`,
        },
        { status: 400 },
      );
    }

    // Server-side validation: Check for parallel paths (non-branching nodes with multiple outgoing edges)
    if (edges && Array.isArray(edges)) {
      const edgesBySource = new Map();
      edges.forEach((edge) => {
        const source = edge.source ;
        const existing = edgesBySource.get(source) || [];
        existing.push(edge);
        edgesBySource.set(source, existing);
      });

      for (const node of nodes) {
        const nodeType = _optionalChain([node, 'access', _4 => _4.data, 'optionalAccess', _5 => _5.type]);
        if (nodeType === 'end') continue; // End nodes have no outgoing edges
        if (BRANCHING_NODE_TYPES.includes(nodeType)) continue; // These can branch

        const outgoingEdges = edgesBySource.get(node.id) || [];
        if (outgoingEdges.length > 1) {
          return NextResponse.json(
            {
              error: `Parallel workflows are not allowed. Node "${_optionalChain([node, 'access', _6 => _6.data, 'optionalAccess', _7 => _7.label]) || node.id}" has ${outgoingEdges.length} outgoing connections.`,
              details:
                'Each node (except Approval and Conditional) can only have ONE outgoing connection.',
            },
            { status: 400 },
          );
        }
      }
    }

    // Validate entity references (roles/departments still exist in the database)
    const entityIds = [];
    for (const node of nodes) {
      const config = _optionalChain([node, 'access', _8 => _8.data, 'optionalAccess', _9 => _9.config]) ;
      const entityId = _optionalChain([config, 'optionalAccess', _10 => _10.roleId]) || _optionalChain([config, 'optionalAccess', _11 => _11.approverRoleId]) || _optionalChain([config, 'optionalAccess', _12 => _12.departmentId]);
      if (entityId && typeof entityId === 'string') {
        entityIds.push(entityId);
      }
    }

    if (entityIds.length > 0) {
      const uniqueEntityIds = [...new Set(entityIds)];

      // Check roles
      const roleIds = nodes
        .filter((n) => {
          const config = _optionalChain([n, 'access', _13 => _13.data, 'optionalAccess', _14 => _14.config]) ;
          return _optionalChain([config, 'optionalAccess', _15 => _15.roleId]) || _optionalChain([config, 'optionalAccess', _16 => _16.approverRoleId]);
        })
        .map((n) => {
          const config = _optionalChain([n, 'access', _17 => _17.data, 'optionalAccess', _18 => _18.config]) ;
          return (_optionalChain([config, 'optionalAccess', _19 => _19.roleId]) || _optionalChain([config, 'optionalAccess', _20 => _20.approverRoleId])) ;
        })
        .filter(Boolean);

      if (roleIds.length > 0) {
        const uniqueRoleIds = [...new Set(roleIds)];
        const { data: existingRoles } = await admin
          .from('roles')
          .select('id')
          .in('id', uniqueRoleIds);

        const existingRoleIds = new Set((existingRoles || []).map((r) => r.id));
        const missingRoles = uniqueRoleIds.filter((id) => !existingRoleIds.has(id));

        if (missingRoles.length > 0) {
          const affectedNodes = nodes
            .filter((n) => {
              const config = _optionalChain([n, 'access', _21 => _21.data, 'optionalAccess', _22 => _22.config]) ;
              return missingRoles.includes((_optionalChain([config, 'optionalAccess', _23 => _23.roleId]) || _optionalChain([config, 'optionalAccess', _24 => _24.approverRoleId])) );
            })
            .map((n) => _optionalChain([n, 'access', _25 => _25.data, 'optionalAccess', _26 => _26.label]) || n.id);

          return NextResponse.json(
            {
              error: `Referenced role(s) no longer exist. Please reconfigure: ${affectedNodes.join(', ')}`,
              details: `${missingRoles.length} role(s) have been deleted. Update the affected node configurations.`,
            },
            { status: 400 },
          );
        }
      }

      // Check departments
      const departmentIds = nodes
        .filter((n) => _optionalChain([(_optionalChain([n, 'access', _27 => _27.data, 'optionalAccess', _28 => _28.config]) ), 'optionalAccess', _29 => _29.departmentId]))
        .map((n) => _optionalChain([(_optionalChain([n, 'access', _30 => _30.data, 'optionalAccess', _31 => _31.config]) ), 'optionalAccess', _32 => _32.departmentId]) )
        .filter(Boolean);

      if (departmentIds.length > 0) {
        const uniqueDeptIds = [...new Set(departmentIds)];
        const { data: existingDepts } = await admin
          .from('departments')
          .select('id')
          .in('id', uniqueDeptIds);

        const existingDeptIds = new Set((existingDepts || []).map((d) => d.id));
        const missingDepts = uniqueDeptIds.filter((id) => !existingDeptIds.has(id));

        if (missingDepts.length > 0) {
          const affectedNodes = nodes
            .filter((n) => {
              const config = _optionalChain([n, 'access', _33 => _33.data, 'optionalAccess', _34 => _34.config]) ;
              return missingDepts.includes(_optionalChain([config, 'optionalAccess', _35 => _35.departmentId]) );
            })
            .map((n) => _optionalChain([n, 'access', _36 => _36.data, 'optionalAccess', _37 => _37.label]) || n.id);

          return NextResponse.json(
            {
              error: `Referenced department(s) no longer exist. Please reconfigure: ${affectedNodes.join(', ')}`,
              details: `${missingDepts.length} department(s) have been deleted. Update the affected node configurations.`,
            },
            { status: 400 },
          );
        }
      }
    }

    // Verify the template exists
    logger.debug('[Workflow Save] Verifying template exists', { templateId });
    const { data: template, error: templateError } = await admin
      .from('workflow_templates')
      .select('id')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      logger.error('[Workflow Save] Template not found', {}, templateError );
      return NextResponse.json({ error: 'Workflow template not found' }, { status: 404 });
    }
    logger.debug('[Workflow Save] Template verified');

    // First, get the node IDs that belong to this template
    logger.debug('[Workflow Save] Getting existing node IDs');
    const { data: existingNodes } = await admin
      .from('workflow_nodes')
      .select('id')
      .eq('workflow_template_id', templateId);

    const existingNodeIds = _optionalChain([existingNodes, 'optionalAccess', _38 => _38.map, 'call', _39 => _39((n) => n.id)]) || [];
    logger.debug('[Workflow Save] Found existing nodes', { count: existingNodeIds.length });

    // Clear ALL FK references to these nodes before deleting them
    if (existingNodeIds.length > 0) {
      logger.debug('[Workflow Save] Clearing FK references for node deletion', {
        count: existingNodeIds.length,
      });

      // 1. Nullify current_node_id on workflow_instances
      await admin
        .from('workflow_instances')
        .update({ current_node_id: null })
        .in('current_node_id', existingNodeIds);

      // 2. Delete workflow_active_steps referencing these nodes
      await admin.from('workflow_active_steps').delete().in('node_id', existingNodeIds);

      // 3. Nullify workflow_history from_node_id and to_node_id references
      await admin
        .from('workflow_history')
        .update({ from_node_id: null })
        .in('from_node_id', existingNodeIds);

      await admin
        .from('workflow_history')
        .update({ to_node_id: null })
        .in('to_node_id', existingNodeIds);
    }

    // Delete existing nodes and connections for this template
    // Connections will be cascade deleted due to foreign key constraint
    logger.debug('[Workflow Save] Deleting existing nodes');
    const { error: deleteError } = await admin
      .from('workflow_nodes')
      .delete()
      .eq('workflow_template_id', templateId);

    if (deleteError) {
      logger.error('[Workflow Save] Error deleting existing nodes', {}, deleteError );
      return NextResponse.json(
        {
          error: 'Failed to clear existing workflow nodes',
        },
        { status: 500 },
      );
    }
    logger.debug('[Workflow Save] Existing nodes deleted successfully');

    // Insert new nodes
    const nodeInserts = nodes.map((node, index) => {
      const data = node.data ;
      const position = node.position ;
      const config = data.config ;

      return {
        id: node.id,
        workflow_template_id: templateId,
        node_type: data.type,
        label: data.label,
        position_x: position.x,
        position_y: position.y,
        step_order: index,
        entity_id: _optionalChain([config, 'optionalAccess', _40 => _40.roleId]) || _optionalChain([config, 'optionalAccess', _41 => _41.approverRoleId]) || null,
        form_template_id: _optionalChain([config, 'optionalAccess', _42 => _42.formTemplateId]) || null,
        settings: {
          department_id: _optionalChain([config, 'optionalAccess', _43 => _43.departmentId]),
          required_approvals: _optionalChain([config, 'optionalAccess', _44 => _44.requiredApprovals]),
          allow_feedback: _optionalChain([config, 'optionalAccess', _45 => _45.allowFeedback]),
          allow_send_back: _optionalChain([config, 'optionalAccess', _46 => _46.allowSendBack]),
          allow_attachments: _optionalChain([config, 'optionalAccess', _47 => _47.allowAttachments]),
          formFields: _optionalChain([config, 'optionalAccess', _48 => _48.formFields]),
          formName: _optionalChain([config, 'optionalAccess', _49 => _49.formName]),
          formDescription: _optionalChain([config, 'optionalAccess', _50 => _50.formDescription]),
          isDraftForm: _optionalChain([config, 'optionalAccess', _51 => _51.isDraftForm]),
          condition_type: _optionalChain([config, 'optionalAccess', _52 => _52.conditionType]),
          conditions: _optionalChain([config, 'optionalAccess', _53 => _53.conditions]),
          sourceFormFieldId: _optionalChain([config, 'optionalAccess', _54 => _54.sourceFormFieldId]),
        },
      };
    });

    logger.debug('[Workflow Save] Inserting nodes', { count: nodeInserts.length });
    logger.debug('[Workflow Save] First node sample', { node: nodeInserts[0] });

    const { error: nodesError } = await admin.from('workflow_nodes').insert(nodeInserts);

    if (nodesError) {
      logger.error('[Workflow Save] Error inserting nodes', {}, nodesError );
      logger.error('[Workflow Save] Node insert data', { nodeInserts });
      return NextResponse.json(
        {
          error: 'Failed to save workflow nodes',
        },
        { status: 500 },
      );
    }
    logger.debug('[Workflow Save] Nodes inserted successfully');

    // Insert new connections/edges
    if (edges && Array.isArray(edges) && edges.length > 0) {
      const connectionInserts = edges.map((edge) => {
        const data = edge.data ;

        return {
          workflow_template_id: templateId,
          from_node_id: edge.source,
          to_node_id: edge.target,
          condition:
            data || edge.sourceHandle
              ? {
                  label: _optionalChain([data, 'optionalAccess', _55 => _55.label]),
                  conditionValue: _optionalChain([data, 'optionalAccess', _56 => _56.conditionValue]),
                  conditionType: _optionalChain([data, 'optionalAccess', _57 => _57.conditionType]),
                  decision: _optionalChain([data, 'optionalAccess', _58 => _58.decision]),
                  // Critical fields for form-based conditional routing
                  sourceFormFieldId: _optionalChain([data, 'optionalAccess', _59 => _59.sourceFormFieldId]),
                  value: _optionalChain([data, 'optionalAccess', _60 => _60.value]),
                  value2: _optionalChain([data, 'optionalAccess', _61 => _61.value2]),
                  // Store sourceHandle for conditional branch edges
                  sourceHandle: edge.sourceHandle,
                }
              : null,
        };
      });

      logger.debug('[Workflow Save] Inserting connections', { count: connectionInserts.length });
      logger.debug('[Workflow Save] First connection sample', { connection: connectionInserts[0] });

      const { error: connectionsError } = await admin
        .from('workflow_connections')
        .insert(connectionInserts);

      if (connectionsError) {
        logger.error('[Workflow Save] Error inserting connections', {}, connectionsError );
        logger.error('[Workflow Save] Connection insert data', { connectionInserts });
        return NextResponse.json(
          {
            error: 'Failed to save workflow connections',
          },
          { status: 500 },
        );
      }
      logger.debug('[Workflow Save] Connections inserted successfully');
    }

    // Auto-deactivate workflow if it has no nodes (or only has nodes but no valid start/end)
    let isActive;
    if (nodes.length === 0) {
      logger.debug('[Workflow Save] No nodes - auto-deactivating workflow');
      const { error: deactivateError } = await admin
        .from('workflow_templates')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', templateId);

      if (deactivateError) {
        logger.error(
          '[Workflow Save] Error auto-deactivating workflow',
          {},
          deactivateError ,
        );
      } else {
        isActive = false;
      }
    }

    return NextResponse.json(
      {
        success: true,
        message:
          nodes.length === 0
            ? 'Workflow saved (deactivated - no nodes)'
            : 'Workflow saved successfully',
        nodeCount: nodes.length,
        edgeCount: _optionalChain([edges, 'optionalAccess', _62 => _62.length]) || 0,
        is_active: isActive, // Include if it was auto-deactivated
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error('Error in PUT /api/admin/workflows/templates/[id]/steps', {}, error );
    return NextResponse.json(
      {
        error: 'Internal server error',
      },
      { status: 500 },
    );
  }
}

// CommonJS exports
exports.PUT = PUT;
