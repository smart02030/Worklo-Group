 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { logger } = require('@/lib/debug-logger');
// GET /api/org-structure/roles - Get all roles with user counts
async function GET(request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const admin = createAdminSupabaseClient();
    if (!admin) return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });

    // Get all roles with department info and user count
    const { data: roles, error } = await admin
      .from('roles')
      .select(
        `
        id,
        name,
        department_id,
        user_roles!user_id(count)
      `,
      )
      .order('name');

    if (error) {
      logger.error('Error fetching roles', {}, error );
      return NextResponse.json({ error: 'Failed to fetch roles' }, { status: 500 });
    }

    // Transform to include user_count as a simple number
    const rolesWithCounts = (roles || []).map((role) => ({
      id: role.id,
      name: role.name,
      department_id: role.department_id,
      user_count: _optionalChain([role, 'access', _ => _.user_roles, 'optionalAccess', _2 => _2[0], 'optionalAccess', _3 => _3.count]) || 0,
    }));

    return NextResponse.json({ success: true, roles: rolesWithCounts }, { status: 200 });
  } catch (error) {
    logger.error('Error in GET /api/org-structure/roles', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
