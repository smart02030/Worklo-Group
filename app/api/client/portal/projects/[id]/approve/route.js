const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { clientApproveProject } = require('@/lib/client-portal-service');
const { z } = require('zod');
const { validateRequestBody } = require('@/lib/validation-schemas');
const { logger } = require('@/lib/debug-logger');
const approveProjectSchema = z.object({
  workflow_instance_id: z.string().uuid('Invalid workflow instance ID'),
  notes: z.string().max(2000, 'Notes too long').optional(),
});

// POST /api/client/portal/projects/[id]/approve - Approve project at workflow approval node
async function POST(request, { params }) {
  const { id } = await params;

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

    // Verify user is a client (hardcoded check - client approval permissions are implicit)
    if (!userProfile.is_client) {
      return NextResponse.json(
        { error: 'Access denied. This endpoint is for client users only.' },
        { status: 403 },
      );
    }

    // Validate request body
    const body = await request.json();
    const validation = validateRequestBody(approveProjectSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Approve project
    const result = await clientApproveProject({
      projectId: id,
      workflowInstanceId: validation.data.workflow_instance_id,
      clientUserId: user.id,
      notes: validation.data.notes || null,
      supabaseClient: supabase,
    });

    return NextResponse.json(
      {
        ...result,
        message: 'Project approved successfully',
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error('Error in POST /api/client/portal/projects/[id]/approve', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.POST = POST;
