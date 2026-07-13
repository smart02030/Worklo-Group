 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextResponse } = require('next/server');
const { Permission } = require('@/lib/permissions');
const { checkPermissionHybrid, isSuperadmin } = require('@/lib/permission-checker');
const { getAuthenticatedUser } = require('@/lib/server-guards');
const { logger } = require('@/lib/debug-logger');
async function GET() {
  try {
    // Get authenticated user (doesn't throw if not authenticated)
    const userProfile = await getAuthenticatedUser();

    if (!userProfile) {
      return NextResponse.json({
        can_manage_roles: false,
        can_view_roles: false,
        is_admin: false,
      });
    }

    // Check actual permissions using permission checker (Phase 9: consolidated to MANAGE_USER_ROLES)
    const canManageRoles = await checkPermissionHybrid(userProfile, Permission.MANAGE_USER_ROLES);
    const canViewRoles = canManageRoles; // Viewing is implied by MANAGE permission

    const roleNames =
      _optionalChain([userProfile, 'access', _ => _.user_roles
, 'optionalAccess', _2 => _2.map, 'call', _3 => _3((ur) => {
          const roles = ur.roles ;
          return _optionalChain([roles, 'optionalAccess', _4 => _4.name]);
        })
, 'access', _5 => _5.filter, 'call', _6 => _6(Boolean)]) || [];
    const isAdmin = isSuperadmin(userProfile);

    return NextResponse.json({
      can_manage_roles: canManageRoles,
      can_view_roles: canViewRoles,
      is_admin: isAdmin,
      roles: roleNames,
    });
  } catch (error) {
    logger.error('Error checking permissions', { action: 'getPermissions' }, error );
    return NextResponse.json(
      {
        can_manage_roles: false,
        can_view_roles: false,
        is_admin: false,
        error: 'Failed to check permissions',
      },
      { status: 500 },
    );
  }
}

// CommonJS exports
exports.GET = GET;
