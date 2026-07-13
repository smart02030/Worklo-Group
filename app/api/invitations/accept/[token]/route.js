 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { createAdminSupabaseClient } = require('@/lib/supabase-server');
const { sendEmail } = require('@/lib/email/mailer');
const { welcomeEmailTemplate } = require('@/lib/email/templates/welcome');
const { logger } = require('@/lib/debug-logger');
// GET - Get invitation details (public, no auth required)
async function GET(
  _request,
  { params },
) {
  try {
    const { token } = await params;

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Invalid invitation link' }, { status: 400 });
    }

    const adminSupabase = createAdminSupabaseClient();
    if (!adminSupabase) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Look up invitation by token with joined data
    const { data: invitation, error } = await adminSupabase
      .from('user_invitations')
      .select(
        `
        id,
        email,
        name,
        status,
        expires_at,
        role_id,
        department_id,
        roles:role_id(id, name),
        departments:department_id(id, name),
        inviter:invited_by(id, name, email)
      `,
      )
      .eq('token', token)
      .single();

    if (error || !invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    // Check if invitation is still pending
    if (invitation.status !== 'pending') {
      return NextResponse.json(
        { error: `This invitation has already been ${invitation.status}` },
        { status: 410 },
      );
    }

    // Check if invitation has expired
    if (new Date(invitation.expires_at) < new Date()) {
      // Update status to expired
      await adminSupabase
        .from('user_invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id);

      return NextResponse.json({ error: 'This invitation has expired' }, { status: 410 });
    }

    // Return safe invitation details (no token or internal IDs)
    return NextResponse.json({
      invitation: {
        email: invitation.email,
        name: invitation.name,
        roleName: _optionalChain([(invitation.roles ), 'optionalAccess', _ => _.name]) || 'Unknown Role',
        departmentName: _optionalChain([(invitation.departments ), 'optionalAccess', _2 => _2.name]) || null,
        inviterName:
          _optionalChain([(invitation.inviter ), 'optionalAccess', _3 => _3.name]) ||
          _optionalChain([(invitation.inviter ), 'optionalAccess', _4 => _4.email]) ||
          'An administrator',
      },
    });
  } catch (error) {
    logger.error('Error fetching invitation details', {}, error );
    return NextResponse.json({ error: 'Failed to load invitation' }, { status: 500 });
  }
}

// POST - Accept invitation and create account
async function POST(
  request,
  { params },
) {
  try {
    const { token } = await params;

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Invalid invitation link' }, { status: 400 });
    }

    const body = await request.json();
    const { password } = body;

    // Validate password
    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 },
      );
    }

    const adminSupabase = createAdminSupabaseClient();
    if (!adminSupabase) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Look up invitation
    const { data: invitation, error: inviteError } = await adminSupabase
      .from('user_invitations')
      .select(
        `
        *,
        roles:role_id(id, name),
        departments:department_id(id, name)
      `,
      )
      .eq('token', token)
      .single();

    if (inviteError || !invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    // Check status
    if (invitation.status !== 'pending') {
      return NextResponse.json(
        { error: `This invitation has already been ${invitation.status}` },
        { status: 410 },
      );
    }

    // Check expiration
    if (new Date(invitation.expires_at) < new Date()) {
      await adminSupabase
        .from('user_invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id);

      return NextResponse.json({ error: 'This invitation has expired' }, { status: 410 });
    }

    // 1. Create auth user
    const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
      email: invitation.email,
      password,
      email_confirm: true,
      user_metadata: {
        name: invitation.name,
      },
    });

    if (authError) {
      logger.error('Failed to create auth user', { error: authError.message });
      if (
        _optionalChain([authError, 'access', _5 => _5.message, 'optionalAccess', _6 => _6.includes, 'call', _7 => _7('already been registered')]) ||
        _optionalChain([authError, 'access', _8 => _8.message, 'optionalAccess', _9 => _9.includes, 'call', _10 => _10('already exists')])
      ) {
        return NextResponse.json(
          { error: 'An account with this email already exists. Please log in instead.' },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
    }

    const userId = authData.user.id;

    // 2. Upsert user profile
    const { error: profileError } = await adminSupabase.from('user_profiles').upsert(
      {
        id: userId,
        email: invitation.email,
        name: invitation.name,
        has_completed_onboarding: false,
        invited_by: invitation.invited_by,
        invitation_id: invitation.id,
      },
      { onConflict: 'id' },
    );

    if (profileError) {
      logger.error('Failed to create user profile', { error: profileError.message, userId });
      // Attempt cleanup of auth user on failure
      await adminSupabase.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: 'Failed to create user profile' }, { status: 500 });
    }

    // 3. Assign role
    const { error: roleError } = await adminSupabase.from('user_roles').insert({
      user_id: userId,
      role_id: invitation.role_id,
      assigned_by: invitation.invited_by,
    });

    if (roleError) {
      logger.error('Failed to assign role', {
        error: roleError.message,
        userId,
        roleId: invitation.role_id,
      });
      // Non-fatal: user can be assigned role later by admin
    }

    // 4. Update invitation status
    const { error: updateError } = await adminSupabase
      .from('user_invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', invitation.id);

    if (updateError) {
      logger.error('Failed to update invitation status', {
        error: updateError.message,
        invitationId: invitation.id,
      });
    }

    // 5. Create onboarding state
    const { error: onboardingError } = await adminSupabase.from('onboarding_state').insert({
      user_id: userId,
      tutorial_completed: false,
      tutorial_step: 0,
      tutorial_data: {},
    });

    if (onboardingError) {
      logger.error('Failed to create onboarding state', { error: onboardingError.message, userId });
      // Non-fatal: onboarding state can be created later
    }

    // 6. Send welcome email (auto-detect domain from request)
    const proto = request.headers.get('x-forwarded-proto') || 'http';
    const host = request.headers.get('host') || 'localhost:3000';
    const appUrl = `${proto}://${host}`;
    const roleName = _optionalChain([(invitation.roles ), 'optionalAccess', _11 => _11.name]) || 'Team Member';

    const emailContent = welcomeEmailTemplate({
      userName: invitation.name,
      roleName,
      loginUrl: `${appUrl}/login`,
    });

    const emailResult = await sendEmail({
      to: invitation.email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    if (!emailResult.success) {
      logger.error('Failed to send welcome email', { error: emailResult.error });
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Account created successfully',
        loginUrl: `${appUrl}/login`,
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error('Error accepting invitation', {}, error );
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}

// CommonJS exports
exports.GET = GET;
exports.POST = POST;
