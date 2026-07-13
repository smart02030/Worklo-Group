const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { getClientProjects } = require('@/lib/client-portal-service');
const { logger } = require('@/lib/debug-logger');
// GET /api/client/portal/projects - Get all projects for client's account
async function GET(request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const admin = createAdminSupabaseClient();
    if (!admin) return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });

    // Get user profile
    const { data: userProfile } = await admin
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Verify user is a client (hardcoded check - client permissions are implicit)
    if (!userProfile.is_client) {
      return NextResponse.json(
        { error: 'Access denied. This endpoint is for client users only.' },
        { status: 403 },
      );
    }

    if (!userProfile.client_account_id) {
      return NextResponse.json(
        { error: 'Client user is not associated with an account' },
        { status: 400 },
      );
    }

    // Get client projects
    const projects = await getClientProjects(user.id);

    return NextResponse.json({ success: true, projects }, { status: 200 });
  } catch (error) {
    logger.error('Error in GET /api/client/portal/projects', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
