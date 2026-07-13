 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextResponse, NextRequest } = require('next/server');
const { createApiSupabaseClient, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');
async function POST(
  request,
  { params },
) {
  try {
    const { roleId } = await params;

    if (!isValidUUID(roleId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    // Check authentication and permission
    const userProfile = await requireAuthAndPermission(Permission.MANAGE_USER_ROLES, {}, request);

    const supabase = createApiSupabaseClient(request);
    const adminClient = createAdminSupabaseClient();
    if (!supabase || !adminClient) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // PRIVILEGE ESCALATION PROTECTION: Prevent users from assigning roles to themselves
    if (userId === userProfile.id) {
      return NextResponse.json(
        {
          error: 'You cannot assign roles to yourself. Please contact an administrator.',
        },
        { status: 403 },
      );
    }

    // Check if role exists
    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select('id, name')
      .eq('id', roleId)
      .single();

    if (roleError || !role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    // Check if user exists
    const { data: targetUser, error: userError } = await supabase
      .from('user_profiles')
      .select('id, name')
      .eq('id', userId)
      .single();

    if (userError || !targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if assignment already exists
    const { data: existingAssignment } = await supabase
      .from('user_roles')
      .select('id')
      .eq('user_id', userId)
      .eq('role_id', roleId)
      .single();

    if (existingAssignment) {
      return NextResponse.json({ error: 'User already has this role' }, { status: 400 });
    }

    // Get user's current roles for logging
    const { data: currentRoles, error: currentRolesError } = await supabase
      .from('user_roles')
      .select(
        `
        role_id,
        roles!inner(name)
      `,
      )
      .eq('user_id', userId);

    if (currentRolesError) {
      logger.error('Error fetching current roles', {}, currentRolesError );
      return NextResponse.json({ error: 'Failed to check current roles' }, { status: 500 });
    }

    // Helper function to check if a role is the "No Assigned Role" / "Unassigned" role
    const isUnassignedRole = (roleName) => {
      if (!roleName) return false;
      const nameLower = roleName.toLowerCase();
      return (
        nameLower === 'no assigned role' ||
        nameLower === 'unassigned' ||
        nameLower.includes('unassigned')
      );
    };

    // Check if user is only in "No Assigned Role" (needs special handling due to P0001 constraint)
    const noAssignedRole = _optionalChain([currentRoles, 'optionalAccess', _ => _.find, 'call', _2 => _2((cr) => {
      const roles = cr.roles ;
      return isUnassignedRole(_optionalChain([roles, 'optionalAccess', _3 => _3.name]) );
    })]);
    const hasOtherRoles = _optionalChain([currentRoles, 'optionalAccess', _4 => _4.some, 'call', _5 => _5((cr) => {
      const roles = cr.roles ;
      return !isUnassignedRole(_optionalChain([roles, 'optionalAccess', _6 => _6.name]) );
    })]);

    if (noAssignedRole && !hasOtherRoles) {
      logger.debug('User is only in "No Assigned Role", will replace with new role', {});
      // Don't remove yet - we'll replace the assignment after adding the new role
    } else if (noAssignedRole && hasOtherRoles) {
      logger.debug(
        'User has "No Assigned Role" + other roles, removing from "No Assigned Role"',
        {},
      );

      const { error: deleteError } = await adminClient
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role_id', noAssignedRole.role_id);

      if (deleteError) {
        logger.error(
          'Error removing user from "No Assigned Role"',
          {},
          deleteError ,
        );
        return NextResponse.json(
          { error: 'Failed to remove user from "No Assigned Role"' },
          { status: 500 },
        );
      }

      logger.debug('User removed from "No Assigned Role"', {});
    } else {
      logger.debug('User is not in "No Assigned Role", keeping existing roles', {});
    }

    // Create the new assignment
    const { error: insertError } = await adminClient.from('user_roles').insert({
      user_id: userId,
      role_id: roleId,
      assigned_by: userProfile.id,
      assigned_at: new Date().toISOString(),
    });

    if (insertError) {
      logger.error('Error assigning user to role', {}, insertError );
      return NextResponse.json({ error: 'Failed to assign user to role' }, { status: 500 });
    }

    // If user was only in "No Assigned Role", remove it now (after adding new role)
    if (noAssignedRole && !hasOtherRoles) {
      logger.debug('Now removing user from "No Assigned Role" (user now has new role)', {});

      const { error: deleteError } = await adminClient
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role_id', noAssignedRole.role_id);

      if (deleteError) {
        logger.error(
          'Error removing user from "No Assigned Role" after assignment',
          {},
          deleteError ,
        );
        // Don't fail the request - user is already assigned to new role
        logger.warn('User assigned to new role but failed to remove from "No Assigned Role"', {});
      } else {
        logger.debug('User removed from "No Assigned Role" after assignment', {});
      }
    }

    logger.info(`User ${targetUser.name} assigned to ${role.name}`, {
      previousRolesCount: _optionalChain([currentRoles, 'optionalAccess', _7 => _7.length]) || 0,
    });

    return NextResponse.json({
      success: true,
      message: `${targetUser.name} assigned to ${role.name}`,
    });
  } catch (error) {
    return handleGuardError(error);
  }
}

// CommonJS exports
exports.POST = POST;
