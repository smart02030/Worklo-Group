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
 * POST /api/projects/[projectId]/escrow/approve — client approves the next
 * milestone.
 *
 * Two layers: this route proves the caller has access to the project; the Go
 * service proves they are the escrow's client, in the same SQL statement that
 * increments. The second is what actually protects the money.
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

    // callerId from the session, never the body — a body-supplied ID would let
    // any authenticated user approve on someone else's behalf.
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
      `/escrow/${lookup.data.id}/approve-milestone`,
      { method: 'POST', request, body: { caller_id: profile.id } },
    );

    if (!response.ok) {
      return escrowServiceErrorResponse(response, data);
    }

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof EscrowServiceUnavailable) {
      return unavailableResponse(error);
    }
    logger.error('Error in POST /api/projects/[projectId]/escrow/approve', {}, error);
    return handleGuardError(error);
  }
}

exports.POST = POST;
