const { NextResponse, NextRequest } = require('next/server');
const { createApiSupabaseClient } = require('@/lib/supabase-server');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
async function GET(request) {
  try {
    // Check authentication and permission
    await requireAuthAndPermission(Permission.MANAGE_USERS, {}, request);

    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      logger.error('Supabase not configured', { action: 'getUsers' });
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // Fetch all user profiles with their roles
    const { data: users, error } = await supabase
      .from('user_profiles')
      .select(
        `
        id,
        name,
        email,
        image,
        user_roles!user_id(
          id,
          roles!role_id(
            id,
            name,
            department_id,
            departments(
              id,
              name
            )
          )
        )
      `,
      )
      .order('name');

    if (error) {
      logger.error('Error fetching users', { action: 'getUsers' }, error);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    return NextResponse.json({ users: users || [] });
  } catch (error) {
    return handleGuardError(error);
  }
}

// CommonJS exports
exports.GET = GET;
