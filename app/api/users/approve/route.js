const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient } = require('@/lib/supabase-server');
const { userApprovalService } = require('@/lib/user-approval-service');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger, apiCall, apiResponse, userAction } = require('@/lib/debug-logger');
async function POST(request) {
  const startTime = Date.now();

  try {
    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      logger.error('Supabase not configured', { action: 'approveUser' });
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // Check authentication and permission
    const userProfile = await requireAuthAndPermission(Permission.MANAGE_USER_ROLES, {}, request);

    // Parse request body
    const body = await request.json();
    const { userId, action, reason } = body;

    if (!userId || !action) {
      logger.error('Missing required fields', { action: 'approveUser', body });
      return NextResponse.json(
        {
          error: 'Missing required fields: userId, action',
        },
        { status: 400 },
      );
    }

    if (!['approve', 'reject'].includes(action)) {
      logger.error('Invalid action', { action: 'approveUser', requestedAction: action });
      return NextResponse.json(
        {
          error: 'Invalid action. Must be "approve" or "reject"',
        },
        { status: 400 },
      );
    }

    apiCall('POST', '/api/users/approve', {
      action: 'approveUser',
      targetUserId: userId,
      actionType: action,
      approverId: userProfile.id,
    });

    let success = false;

    if (action === 'approve') {
      success = await userApprovalService.approveUser(userId, userProfile.id, reason);
      if (success) {
        userAction('approved', userId, {
          action: 'approveUser',
          approvedBy: userProfile.id,
          reason,
        });
        logger.info('User approved successfully', {
          action: 'approveUser',
          userId,
          approvedBy: userProfile.id,
        });
      }
    } else if (action === 'reject') {
      success = await userApprovalService.rejectUser(userId, userProfile.id, reason);
      if (success) {
        userAction('rejected', userId, {
          action: 'approveUser',
          rejectedBy: userProfile.id,
          reason,
        });
        logger.info('User rejected successfully', {
          action: 'approveUser',
          userId,
          rejectedBy: userProfile.id,
        });
      }
    }

    const duration = Date.now() - startTime;
    apiResponse('POST', '/api/users/approve', success ? 200 : 400, {
      action: 'approveUser',
      duration,
      success,
    });

    if (!success) {
      logger.error('Failed to process user approval', {
        action: 'approveUser',
        userId,
        actionType: action,
        duration,
      });
      return NextResponse.json(
        {
          error: `Failed to ${action} user`,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      message: `User ${action}d successfully`,
    });
  } catch (error) {
    return handleGuardError(error);
  }
}
async function GET(request) {
  const startTime = Date.now();

  try {
    // Check authentication and permission first
    await requireAuthAndPermission(Permission.MANAGE_USER_ROLES, {}, request);

    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      logger.error('Supabase not configured', { action: 'getApprovalStats' });
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    apiCall('GET', '/api/users/approve', { action: 'getApprovalStats' });

    const stats = await userApprovalService.getApprovalStats();

    const duration = Date.now() - startTime;
    apiResponse('GET', '/api/users/approve', 200, {
      action: 'getApprovalStats',
      duration,
    });

    logger.info('Approval stats retrieved', {
      action: 'getApprovalStats',
      ...stats,
      duration,
    });

    return NextResponse.json({ stats });
  } catch (error) {
    return handleGuardError(error);
  }
}

// CommonJS exports
exports.POST = POST;
exports.GET = GET;
