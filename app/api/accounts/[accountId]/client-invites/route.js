 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { hasAccountAccessServer } = require('@/lib/access-control-server');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');
// GET /api/accounts/[id]/client-invites - List client invitations for an account
async function GET(
  request,
  { params },
) {
  try {
    const { accountId } = await params;

    if (!isValidUUID(accountId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

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

    // Check MANAGE_CLIENT_INVITES permission
    const canManageInvites = await hasPermission(
      userProfile,
      Permission.MANAGE_CLIENT_INVITES,
      undefined,
      admin,
    );
    if (!canManageInvites) {
      return NextResponse.json(
        { error: 'Insufficient permissions to view client invitations' },
        { status: 403 },
      );
    }

    // Verify user has access to this account
    const hasAccess = await hasAccountAccessServer(supabase, user.id, accountId);
    if (!hasAccess) {
      return NextResponse.json(
        {
          error: 'You do not have access to this account',
        },
        { status: 403 },
      );
    }

    // Query invitations directly using the API supabase client (with proper auth context)
    // instead of delegating to a service that creates its own server-side client.
    // The client_portal_invitations table has: id, account_id, email, invited_by, status, created_at, expires_at
    const { data: invitationsRaw, error: invitationsError } = await admin
      .from('client_portal_invitations')
      .select(
        `
        *,
        invited_by_user:user_profiles (
          name,
          email
        )
      `,
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    if (invitationsError) {
      logger.error('Error fetching invitations', {}, invitationsError );

      // If the table doesn't exist, return empty array gracefully
      if (
        invitationsError.code === 'PGRST116' ||
        invitationsError.code === '42P01' ||
        _optionalChain([invitationsError, 'access', _ => _.message, 'optionalAccess', _2 => _2.includes, 'call', _3 => _3('does not exist')])
      ) {
        return NextResponse.json({ success: true, invitations: [] }, { status: 200 });
      }

      return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 });
    }

    // Map the data to match the frontend's expected format
    // DB columns: id, account_id, email, invited_by, status, created_at, expires_at
    // Frontend expects: id, email, status, created_at, expires_at, accepted_at, invited_by_user
    const invitations = (invitationsRaw || []).map((inv) => ({
      id: inv.id,
      email: inv.email,
      status: inv.status,
      created_at: inv.created_at,
      expires_at: inv.expires_at,
      accepted_at: inv.accepted_at || null,
      invited_by_user: inv.invited_by_user || null,
    }));

    return NextResponse.json({ success: true, invitations }, { status: 200 });
  } catch (error) {
    logger.error('Error in GET /api/accounts/[id]/client-invites', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
