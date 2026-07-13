 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { userHasProjectAccess } = require('@/lib/rbac');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');
/**
 * PUT /api/projects/[projectId]/updates/[updateId]
 * Update a project update
 */
async function PUT(
  request,
  { params },
) {
  try {
    const { projectId, updateId } = await params;
    if (!isValidUUID(projectId) || !isValidUUID(updateId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const admin = createAdminSupabaseClient();
    if (!admin) return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });

    // Get user profile
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

    // Check project access - if user has access to the project, they can edit updates
    const hasAccess = await userHasProjectAccess(userProfile, projectId, admin);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Insufficient permissions to edit updates' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { content } = body;

    if (!_optionalChain([content, 'optionalAccess', _ => _.trim, 'call', _2 => _2()])) {
      return NextResponse.json({ error: 'Update content cannot be empty' }, { status: 400 });
    }

    // Only the creator can edit their update (or superadmin via RLS)
    const { data: update, error } = await admin
      .from('project_updates')
      .update({
        content: content.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', updateId)
      .eq('project_id', projectId)
      .eq('created_by', user.id)
      .select(
        `
        *,
        user_profiles:user_profiles(id, name, email, image)
      `,
      )
      .single();

    if (error) {
      logger.error('Error updating update:', {}, error );
      return NextResponse.json({ error: 'Failed to update update' }, { status: 500 });
    }

    return NextResponse.json({ success: true, update });
  } catch (error) {
    logger.error('Error in PUT /api/projects/[projectId]/updates/[updateId]:', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/projects/[projectId]/updates/[updateId]
 * Delete a project update
 */
async function DELETE(
  request,
  { params },
) {
  try {
    const { projectId, updateId } = await params;
    if (!isValidUUID(projectId) || !isValidUUID(updateId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const admin = createAdminSupabaseClient();
    if (!admin) return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });

    // Get user profile
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

    // Check project access - if user has access to the project, they can delete updates
    const hasAccess = await userHasProjectAccess(userProfile, projectId, admin);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Insufficient permissions to delete updates' },
        { status: 403 },
      );
    }

    // Only the creator can delete their update (or superadmin via RLS)
    const { error } = await admin
      .from('project_updates')
      .delete()
      .eq('id', updateId)
      .eq('project_id', projectId)
      .eq('created_by', user.id);

    if (error) {
      logger.error('Error deleting update:', {}, error );
      return NextResponse.json({ error: 'Failed to delete update' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(
      'Error in DELETE /api/projects/[projectId]/updates/[updateId]:',
      {},
      error ,
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.PUT = PUT;
exports.DELETE = DELETE;
