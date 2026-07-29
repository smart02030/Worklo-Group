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
 * GET /api/projects/[projectId]/escrow
 *
 * Proxies to the Go service. The project → escrow lookup happens there, not
 * here: escrows are that service's data.
 */
async function GET(request, { params }) {
  try {
    const { projectId } = await params;

    if (!isValidUUID(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    // A read: the client and assigned contributors need it, so not MANAGE.
    await requireAuthAndPermission(Permission.VIEW_PROJECTS, { projectId }, request);

    const { response, data } = await callEscrowService(`/project/${projectId}/escrow`, {
      method: 'GET',
      request,
    });

    if (response.status === 404) {
      // Not an error condition — the UI renders the "create escrow" form.
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 });
    }
    if (!response.ok) {
      return escrowServiceErrorResponse(response, data);
    }

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof EscrowServiceUnavailable) {
      return unavailableResponse(error);
    }
    logger.error('Error in GET /api/projects/[projectId]/escrow', {}, error);
    return handleGuardError(error);
  }
}

/**
 * POST /api/projects/[projectId]/escrow
 *
 * Creates a new escrow for the project via the Go escrow service.
 *
 * Body: { totalMilestones: number, amountPerMilestone: number, contractorId: string }
 */
async function POST(request, { params }) {
  try {
    const { projectId } = await params;

    if (!isValidUUID(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    // VIEW not MANAGE: client_id is the caller, so the caller must BE the
    // client. MANAGE_PROJECTS would let only PMs create an escrow and record
    // the PM as the payer. Still project-scoped, so they must be assigned.
    await requireAuthAndPermission(Permission.VIEW_PROJECTS, { projectId }, request);

    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection not available' }, { status: 500 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { totalMilestones, amountPerMilestone, contractorId } = body;
    if (!totalMilestones || !amountPerMilestone || !contractorId) {
      return NextResponse.json(
        { error: 'totalMilestones, amountPerMilestone, and contractorId are required' },
        { status: 400 },
      );
    }

    if (!isValidUUID(contractorId)) {
      return NextResponse.json({ error: 'contractorId must be a valid UUID' }, { status: 400 });
    }

    // Whole cents only — a float would silently round into an int64.
    if (!Number.isInteger(totalMilestones) || totalMilestones < 1) {
      return NextResponse.json(
        { error: 'totalMilestones must be a positive integer' },
        { status: 400 },
      );
    }
    if (!Number.isInteger(amountPerMilestone) || amountPerMilestone < 1) {
      return NextResponse.json(
        { error: 'amountPerMilestone must be a positive integer number of cents' },
        { status: 400 },
      );
    }

    // client_id from the session, never the body — otherwise a caller could
    // name someone else as the paying party.
    const profile = await getUserProfileFromRequest(supabase);
    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 401 });
    }

    const { response, data } = await callEscrowService('/escrow', {
      method: 'POST',
      request,
      body: {
        project_id: projectId,
        client_id: profile.id,
        contractor_id: contractorId,
        total_milestones: totalMilestones,
        amount_per_milestone: amountPerMilestone,
      },
    });

    if (!response.ok) {
      return escrowServiceErrorResponse(response, data);
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    if (error instanceof EscrowServiceUnavailable) {
      return unavailableResponse(error);
    }
    logger.error('Error in POST /api/projects/[projectId]/escrow', {}, error);
    return handleGuardError(error);
  }
}

exports.GET = GET;
exports.POST = POST;
