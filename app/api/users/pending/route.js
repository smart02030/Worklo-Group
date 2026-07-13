const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient } = require('@/lib/supabase-server');
const { userApprovalService } = require('@/lib/user-approval-service');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger, apiCall, apiResponse } = require('@/lib/debug-logger');
async function GET(request) {
  const startTime = Date.now();

  try {
    // Check authentication and permission (approving users is part of user role management)
    await requireAuthAndPermission(Permission.MANAGE_USER_ROLES, {}, request);

    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      logger.error('Supabase not configured', { action: 'getPendingUsers' });
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    apiCall('GET', '/api/users/pending', { action: 'getPendingUsers' });

    const pendingUsers = await userApprovalService.getPendingUsers();

    const duration = Date.now() - startTime;
    apiResponse('GET', '/api/users/pending', 200, {
      action: 'getPendingUsers',
      duration,
      count: pendingUsers.length,
    });

    logger.info('Pending users retrieved', {
      action: 'getPendingUsers',
      count: pendingUsers.length,
      duration,
    });

    return NextResponse.json({
      users: pendingUsers,
      count: pendingUsers.length,
    });
  } catch (error) {
    return handleGuardError(error);
  }
}

// CommonJS exports
exports.GET = GET;
