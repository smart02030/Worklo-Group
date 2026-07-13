const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { submitClientFeedback } = require('@/lib/client-portal-service');
const { validateRequestBody, submitClientFeedbackSchema } = require('@/lib/validation-schemas');
const { logger } = require('@/lib/debug-logger');
// POST /api/client/portal/projects/[id]/feedback - Submit client feedback
async function POST(request, { params }) {
  const { id } = await params;

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

    // Phase 9: Client permissions are hardcoded - verify user is a client with account access
    if (!userProfile.is_client || !userProfile.client_account_id) {
      return NextResponse.json({ error: 'Client access required' }, { status: 403 });
    }

    // Validate request body
    const body = await request.json();
    const validation = validateRequestBody(submitClientFeedbackSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Submit feedback
    const feedback = await submitClientFeedback({
      projectId: id,
      clientUserId: user.id,
      satisfactionScore: validation.data.satisfaction_score || undefined,
      whatWentWell: validation.data.what_went_well || undefined,
      whatNeedsImprovement: validation.data.what_needs_improvement || undefined,
      workflowHistoryId: validation.data.workflow_history_id || undefined,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Thank you for your feedback!',
        feedback,
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error('Error in POST /api/client/portal/projects/[id]/feedback', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.POST = POST;
