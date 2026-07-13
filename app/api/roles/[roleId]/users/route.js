 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextResponse, NextRequest } = require('next/server');
const { createApiSupabaseClient } = require('@/lib/supabase-server');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');
async function GET(
  request,
  { params },
) {
  try {
    const { roleId } = await params;

    if (!isValidUUID(roleId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    // Check authentication and permission
    await requireAuthAndPermission(Permission.MANAGE_USER_ROLES, {}, request);

    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // Fetch users assigned to this role
    const { data, error } = await supabase
      .from('user_roles')
      .select(
        `
        user_id,
        user_profiles:user_id (
          id,
          name,
          email,
          image
        )
      `,
      )
      .eq('role_id', roleId);

    if (error) {
      logger.error('Error fetching role users', {}, error );
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    // Extract user profiles from the join
    const users = _optionalChain([data, 'optionalAccess', _ => _.map, 'call', _2 => _2((item) => item.user_profiles), 'access', _3 => _3.filter, 'call', _4 => _4(Boolean)]) || [];

    return NextResponse.json(users);
  } catch (error) {
    return handleGuardError(error);
  }
}

// CommonJS exports
exports.GET = GET;
