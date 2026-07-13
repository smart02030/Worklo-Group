 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }/**
 * API Route: RBAC Diagnostics
 * Provides diagnostic information about roles, permissions, and user assignments
 */
const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { hasPermission, isSuperadmin } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
// Type definitions



async function GET(request) {
  try {
    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection not available' }, { status: 500 });
    }

    const userProfile = await getUserProfileFromRequest(supabase);
    if (!userProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has permission to view RBAC diagnostics
    const canManageUsers = await hasPermission(
      userProfile,
      Permission.MANAGE_USERS,
      undefined,
      admin,
    );
    if (!canManageUsers && !isSuperadmin(userProfile)) {
      return NextResponse.json(
        { error: 'Forbidden: Insufficient permissions to access RBAC diagnostics' },
        { status: 403 },
      );
    }

    // Fetch all users with their roles
    const { data: users, error: usersError } = await supabase
      .from('user_profiles')
      .select(
        `
        id,
        name,
        email,
        is_superadmin,
        user_roles!user_id(
          id,
          role_id,
          roles!role_id(
            id,
            name,
            department_id,
            permissions,
            departments (
              id,
              name
            )
          )
        )
      `,
      )
      .order('name');

    if (usersError) {
      logger.error('Error fetching users for diagnostics:', {}, usersError );
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    // Fetch all roles with user counts
    const { data: roles, error: rolesError } = await supabase
      .from('roles')
      .select(
        `
        id,
        name,
        permissions,
        department_id,
        departments (
          name
        )
      `,
      )
      .order('name');

    if (rolesError) {
      logger.error('Error fetching roles for diagnostics:', {}, rolesError );
      return NextResponse.json({ error: 'Failed to fetch roles' }, { status: 500 });
    }

    // Count users per role
    const rolesWithCounts = await Promise.all(
      (roles || []).map(async (role) => {
        const { count } = await supabase
          .from('user_roles')
          .select('*', { count: 'exact', head: true })
          .eq('role_id', role.id);

        const departments = role.departments ;
        return {
          id: role.id,
          name: role.name,
          department_name: _optionalChain([departments, 'optionalAccess', _ => _.name]) || 'Unknown',
          permissions: role.permissions || {},
          user_count: count || 0,
        };
      }),
    );

    return NextResponse.json({
      success: true,
      users: users || [],
      roles: rolesWithCounts,
    });
  } catch (error) {
    const err = error ;
    logger.error('Error in GET /api/admin/rbac-diagnostics:', {}, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
