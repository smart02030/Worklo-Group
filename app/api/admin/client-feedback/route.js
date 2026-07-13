const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { getAllClientFeedback } = require('@/lib/client-portal-service');
const { logger } = require('@/lib/debug-logger');
// GET /api/admin/client-feedback - Admin view of all client feedback
async function GET(request) {
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

    // Phase 9: VIEW_CLIENT_FEEDBACK → MANAGE_CLIENT_INVITES (consolidated admin permission)
    const canView = await hasPermission(
      userProfile,
      Permission.MANAGE_CLIENT_INVITES,
      undefined,
      admin,
    );
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions to view client feedback' },
        { status: 403 },
      );
    }

    // Get all feedback
    const feedback = await getAllClientFeedback();

    return NextResponse.json({ success: true, feedback }, { status: 200 });
  } catch (error) {
    logger.error('Error in GET /api/admin/client-feedback', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
