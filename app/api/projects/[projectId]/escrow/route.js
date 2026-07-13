const { NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');

const ESCROW_SERVICE_URL = process.env.GO_ESCROW_SERVICE_URL || 'http://localhost:4001';

/**
 * GET /api/projects/[projectId]/escrow
 *
 * Proxies to the Go escrow service GET /escrow/:id endpoint.
 * Returns the escrow state as JSON, or 404 if the escrow does not exist.
 *
 * TODO: implement
 *   1. Look up the escrow ID for this project (stored in Supabase or returned by the Go service)
 *   2. GET {ESCROW_SERVICE_URL}/escrow/{escrowId}
 *   3. Forward the response (or 404 if not found)
 */
async function GET(request, { params }) {
  try {
    const { projectId } = await params;

    if (!isValidUUID(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    await requireAuthAndPermission(Permission.MANAGE_PROJECTS, { projectId }, request);

    // TODO: resolve escrow ID for this project then call:
    // const res = await fetch(`${ESCROW_SERVICE_URL}/escrow/${escrowId}`);
    // if (res.status === 404) return NextResponse.json({ error: 'Escrow not found' }, { status: 404 });
    // return NextResponse.json(await res.json());

    return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
  } catch (error) {
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
 *
 * TODO: implement
 *   1. Parse and validate the request body
 *   2. Fetch the current user profile to use as client_id
 *   3. POST {ESCROW_SERVICE_URL}/escrow with the full payload
 *   4. Return the created escrow JSON from the Go service
 */
async function POST(request, { params }) {
  try {
    const { projectId } = await params;

    if (!isValidUUID(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    await requireAuthAndPermission(Permission.MANAGE_PROJECTS, { projectId }, request);

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

    // TODO: resolve clientId from the authenticated session, then call:
    // const res = await fetch(`${ESCROW_SERVICE_URL}/escrow`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     project_id: projectId,
    //     client_id: clientId,
    //     contractor_id: contractorId,
    //     total_milestones: totalMilestones,
    //     amount_per_milestone: amountPerMilestone,
    //   }),
    // });
    // const data = await res.json();
    // if (!res.ok) return NextResponse.json(data, { status: res.status });
    // return NextResponse.json(data, { status: 201 });

    return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
  } catch (error) {
    logger.error('Error in POST /api/projects/[projectId]/escrow', {}, error);
    return handleGuardError(error);
  }
}

exports.GET = GET;
exports.POST = POST;
