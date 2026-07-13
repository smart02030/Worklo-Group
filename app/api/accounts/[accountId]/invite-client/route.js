 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { sendClientInvitation } = require('@/lib/client-portal-service');
const { validateRequestBody, sendClientInvitationSchema } = require('@/lib/validation-schemas');
const { hasAccountAccessServer } = require('@/lib/access-control-server');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');
const { sendEmail } = require('@/lib/email/mailer');
const { clientInvitationEmailHtml, clientInvitationEmailText,  } = require('@/lib/email/templates/client-invitation');
// POST /api/accounts/[id]/invite-client - Send client portal invitation
async function POST(
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
    const canInvite = await hasPermission(
      userProfile,
      Permission.MANAGE_CLIENT_INVITES,
      undefined,
      admin,
    );
    if (!canInvite) {
      return NextResponse.json(
        { error: 'Insufficient permissions to send client invitations' },
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

    // Validate request body
    const body = await request.json();
    const validation = validateRequestBody(sendClientInvitationSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Send invitation
    const invitation = await sendClientInvitation({
      accountId: accountId,
      email: validation.data.email,
      invitedBy: user.id,
      expiresInDays: validation.data.expires_in_days,
    });

    // Send invitation email
    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/client-invite/${invitation.token}`;

    // Fetch account name for email
    const { data: account } = await admin
      .from('accounts')
      .select('name')
      .eq('id', accountId)
      .single();

    const emailResult = await sendEmail({
      to: invitation.email,
      subject: `You're invited to ${_optionalChain([account, 'optionalAccess', _ => _.name]) || 'a project'} on Worklo`,
      html: clientInvitationEmailHtml({
        accountName: _optionalChain([account, 'optionalAccess', _2 => _2.name]) || 'Your Account',
        inviteUrl,
        expiresInDays: 7,
      }),
      text: clientInvitationEmailText({
        accountName: _optionalChain([account, 'optionalAccess', _3 => _3.name]) || 'Your Account',
        inviteUrl,
        expiresInDays: 7,
      }),
    });

    if (!emailResult.success) {
      logger.warn('Failed to send client invitation email', {
        email: invitation.email,
        error: emailResult.error,
      });
      // Don't fail the request — invitation is created, email can be resent
    }

    return NextResponse.json({ success: true, invitation }, { status: 201 });
  } catch (error) {
    const err = error ;
    logger.error('Error in POST /api/accounts/[id]/invite-client', {}, err);

    if (_optionalChain([err, 'access', _4 => _4.message, 'optionalAccess', _5 => _5.includes, 'call', _6 => _6('pending invitation already exists')])) {
      return NextResponse.json(
        { error: 'A pending invitation already exists for this email' },
        { status: 409 },
      );
    }
    if (_optionalChain([err, 'access', _7 => _7.message, 'optionalAccess', _8 => _8.includes, 'call', _9 => _9('internal user')]) || _optionalChain([err, 'access', _10 => _10.message, 'optionalAccess', _11 => _11.includes, 'call', _12 => _12('already exists')])) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to send invitation' }, { status: 500 });
  }
}

// CommonJS exports
exports.POST = POST;
