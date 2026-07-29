const { NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');
const {
  callEscrowService,
  escrowServiceErrorResponse,
  unavailableResponse,
  EscrowServiceUnavailable,
} = require('@/lib/escrow-service-client');

/**
 * POST /api/projects/[projectId]/escrow/claim — contractor claims the next
 * approved milestone and triggers its payout.
 *
 * Never retries: a blind retry of an ambiguous timeout would claim the NEXT
 * milestone rather than re-attempt the previous one. On timeout the honest
 * answer is 503 and a refetch.
 */
async function POST(request, { params }) {
  try {
    const { projectId } = await params;

    if (!isValidUUID(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    await requireAuthAndPermission(Permission.VIEW_PROJECTS, { projectId }, request);

    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection not available' }, { status: 500 });
    }

    const profile = await getUserProfileFromRequest(supabase);
    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 401 });
    }

    const lookup = await callEscrowService(`/project/${projectId}/escrow`, {
      method: 'GET',
      request,
    });
    if (lookup.response.status === 404) {
      return NextResponse.json({ error: 'No escrow exists for this project' }, { status: 404 });
    }
    if (!lookup.response.ok) {
      return escrowServiceErrorResponse(lookup.response, lookup.data);
    }

    const { response, data } = await callEscrowService(
      `/escrow/${lookup.data.id}/claim-milestone`,
      {
        method: 'POST',
        request,
        body: { caller_id: profile.id },
      },
    );

    if (!response.ok) {
      return escrowServiceErrorResponse(response, data);
    }

    // 200 means the claim is committed; transfer.status may still be
    // "pending". Passed through so the UI can say so.
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof EscrowServiceUnavailable) {
      return unavailableResponse(error);
    }
    logger.error('Error in POST /api/projects/[projectId]/escrow/claim', {}, error);
    return handleGuardError(error);
  }
}

exports.POST = POST;
