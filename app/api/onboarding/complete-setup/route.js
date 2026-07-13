 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { createAdminSupabaseClient } = require('@/lib/supabase-server');
const { validateSetupToken, consumeSetupToken, isFirstRun } = require('@/lib/onboarding/setup-token');
async function POST(request) {
  // Only works during first run
  const firstRun = await isFirstRun();
  if (!firstRun) {
    return NextResponse.json({ error: 'Setup already completed' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!_optionalChain([body, 'optionalAccess', _ => _.token]) || !_optionalChain([body, 'optionalAccess', _2 => _2.email]) || !_optionalChain([body, 'optionalAccess', _3 => _3.password]) || !_optionalChain([body, 'optionalAccess', _4 => _4.name])) {
    return NextResponse.json(
      { error: 'Token, email, password, and name are required' },
      { status: 400 },
    );
  }

  // Validate token
  const valid = await validateSetupToken(body.token);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid or expired setup token' }, { status: 401 });
  }

  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  // Create auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true, // Skip email confirmation for superadmin
    user_metadata: { name: body.name },
  });

  if (authError || !authData.user) {
    return NextResponse.json(
      { error: _optionalChain([authError, 'optionalAccess', _5 => _5.message]) || 'Failed to create user' },
      { status: 500 },
    );
  }

  const userId = authData.user.id;

  // Create user profile (the DB trigger may also do this, but we ensure it with our values)
  const { error: profileError } = await supabase.from('user_profiles').upsert({
    id: userId,
    email: body.email,
    name: body.name,
    is_superadmin: true,
    has_completed_onboarding: false,
  });

  if (profileError) {
    console.error('Profile creation error:', profileError);
  }

  // Assign Superadmin role
  const { error: roleError } = await supabase.from('user_roles').insert({
    user_id: userId,
    role_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', // Superadmin role from seed
    assigned_by: userId,
  });

  if (roleError) {
    console.error('Role assignment error:', roleError);
  }

  // Create onboarding state
  await supabase.from('onboarding_state').insert({
    user_id: userId,
    tutorial_completed: false,
    tutorial_step: 0,
  });

  // Consume the token
  await consumeSetupToken(body.token, userId);

  return NextResponse.json({
    success: true,
    message: 'Superadmin account created successfully',
    user: { id: userId, email: body.email, name: body.name },
  });
}

// CommonJS exports
exports.POST = POST;
