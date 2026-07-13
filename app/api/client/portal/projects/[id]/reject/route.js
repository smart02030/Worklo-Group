const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { clientRejectProject } = require('@/lib/client-portal-service');
const { z } = require('zod');
const { validateRequestBody } = require('@/lib/validation-schemas');
const { logger } = require('@/lib/debug-logger');
const rejectProjectSchema = z.object({
  workflow_instance_id: z.string().uuid('Invalid workflow instance ID'),
  notes: z.string().max(2000, 'Notes too long'),
  issues: z.array(z.string()).optional(),
});

// POST /api/client/portal/projects/[id]/reject - Reject project at workflow approval node
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
    const validation = validateRequestBody(rejectProjectSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Reject project (pass authenticated supabase client for proper RLS context)
    const result = await clientRejectProject({
      projectId: id,
      workflowInstanceId: validation.data.workflow_instance_id,
      clientUserId: user.id,
      notes: validation.data.notes,
      issues: validation.data.issues || [],
      supabaseClient: supabase,
    });

    return NextResponse.json(
      {
        ...result,
        message: 'Project rejected. Issues have been logged.',
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error('Error in POST /api/client/portal/projects/[id]/reject', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.POST = POST;
