const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient } = require('@/lib/supabase-server');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');
// Type definitions
async function GET(
  request,
  { params },
) {
  try {
    // Await params (Next.js 15 requirement)
    const { projectId } = await params;

    if (!isValidUUID(projectId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    // Check authentication and permission
    await requireAuthAndPermission(Permission.VIEW_PROJECTS, { projectId }, request);

    // Use API Supabase client (not createServerSupabase which crashes in API routes)
    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // Fetch stakeholders - specify the relationship to avoid ambiguity
    const { data, error } = await supabase
      .from('project_stakeholders')
      .select(
        `
        id,
        user_id,
        role,
        user_profiles:user_profiles(
          id,
          name,
          email,
          image
        )
      `,
      )
      .eq('project_id', projectId);

    if (error) {
      logger.error('Error fetching stakeholders', { action: 'getStakeholders', projectId }, error);
      return NextResponse.json({ error: 'Failed to fetch stakeholders' }, { status: 500 });
    }

    return NextResponse.json({ stakeholders: data || [] });
  } catch (error) {
    return handleGuardError(error);
  }
}

// CommonJS exports
exports.GET = GET;
