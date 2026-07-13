 function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } }/**
 * API Route: User Availability
 * Endpoints for managing weekly user work capacity
 */
const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { availabilityService } = require('@/lib/services/availability-service');
const { hasPermission } = require('@/lib/permission-checker');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
const { z } = require('zod');
const createAvailabilitySchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  availableHours: z.number().min(0).max(168),
  scheduleData: z.any().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

// Type definitions





/**
 * GET /api/availability
 * Get user availability for a specific week
 * Query params: userId, weekStartDate
 */
async function GET(request) {
  try {
    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection not available' }, { status: 500 });
    }

    // Get current user
    const userProfile = await getUserProfileFromRequest(supabase);
    if (!userProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = _nullishCoalesce(searchParams.get('userId'), () => ( userProfile.id));
    const weekStartDate =
      _nullishCoalesce(searchParams.get('weekStartDate'), () => ( availabilityService.getWeekStartDate()));

    // Permission check: can view own or has VIEW_TEAM_CAPACITY/VIEW_ALL_CAPACITY
    const isOwnData = userId === userProfile.id;
    if (!isOwnData) {
      const canViewTeam = await hasPermission(
        userProfile,
        Permission.VIEW_TEAM_CAPACITY,
        undefined,
        admin,
      );
      const canViewAll = await hasPermission(
        userProfile,
        Permission.VIEW_ALL_CAPACITY,
        undefined,
        admin,
      );

      if (!canViewTeam && !canViewAll) {
        return NextResponse.json(
          { error: "Insufficient permissions to view other users' availability" },
          { status: 403 },
        );
      }
    }

    const availability = await availabilityService.getUserAvailability(
      userId,
      weekStartDate,
      admin,
    );

    return NextResponse.json({
      success: true,
      availability,
    });
  } catch (error) {
    const err = error ;
    logger.error('Error in GET /api/availability', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/availability
 * Set or update user availability for a week
 * Body: { userId, weekStartDate, availableHours, scheduleData?, notes? }
 */
async function POST(request) {
  try {
    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection not available' }, { status: 500 });
    }

    // Get current user
    const userProfile = await getUserProfileFromRequest(supabase);
    if (!userProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let rawBody;
    try {
      rawBody = await request.json();
    } catch (e) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Validate with Zod schema
    const parsed = createAvailabilitySchema.safeParse(rawBody);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json({ error: firstError.message }, { status: 400 });
    }
    const { userId, weekStartDate, availableHours, scheduleData, notes } = parsed.data;

    // Permission check: can only edit own availability
    if (userId !== userProfile.id) {
      return NextResponse.json({ error: 'Can only edit your own availability' }, { status: 403 });
    }

    // Check EDIT_OWN_AVAILABILITY permission
    const canEdit = await hasPermission(
      userProfile,
      Permission.EDIT_OWN_AVAILABILITY,
      undefined,
      admin,
    );
    if (!canEdit) {
      return NextResponse.json(
        { error: 'Insufficient permissions to edit availability' },
        { status: 403 },
      );
    }

    const availability = await availabilityService.setUserAvailability(
      userId,
      weekStartDate,
      availableHours,
      _nullishCoalesce(scheduleData, () => ( undefined)),
      _nullishCoalesce(notes, () => ( undefined)),
      supabase,
    );

    if (!availability) {
      return NextResponse.json({ error: 'Failed to set availability' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      availability,
    });
  } catch (error) {
    const err = error ;
    logger.error('Error in POST /api/availability', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/availability
 * Delete user availability for a week
 * Query params: userId, weekStartDate
 */
async function DELETE(request) {
  try {
    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection not available' }, { status: 500 });
    }

    // Get current user
    const userProfile = await getUserProfileFromRequest(supabase);
    if (!userProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const weekStartDate = searchParams.get('weekStartDate');

    if (!userId || !weekStartDate) {
      return NextResponse.json(
        { error: 'Missing required parameters: userId, weekStartDate' },
        { status: 400 },
      );
    }

    // Permission check: can only delete own availability
    if (userId !== userProfile.id) {
      return NextResponse.json({ error: 'Can only delete your own availability' }, { status: 403 });
    }

    const success = await availabilityService.deleteUserAvailability(userId, weekStartDate, admin);

    if (!success) {
      return NextResponse.json({ error: 'Failed to delete availability' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Availability deleted successfully',
    });
  } catch (error) {
    const err = error ;
    logger.error('Error in DELETE /api/availability', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
exports.POST = POST;
exports.DELETE = DELETE;
