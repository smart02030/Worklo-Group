 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { isFirstRun, createSetupToken, validateSetupToken } = require('@/lib/onboarding/setup-token');
// GET - Check if first run + generate token
async function GET() {
  const firstRun = await isFirstRun();
  if (!firstRun) {
    return NextResponse.json({ firstRun: false, message: 'Platform already has users.' });
  }

  const token = await createSetupToken();
  if (!token) {
    return NextResponse.json(
      {
        error:
          'Failed to generate setup token. Make sure SUPABASE_SERVICE_ROLE_KEY is set in .env.local',
        hint: 'Check that your .env.local file has the SUPABASE_SERVICE_ROLE_KEY from your Supabase config.',
      },
      { status: 500 },
    );
  }

  // Log token to server console (uses console.warn so it survives production mode)
  console.warn('\n========================================');
  console.warn('SUPERADMIN SETUP TOKEN');
  console.warn(`   Token: ${token}`);
  console.warn('   Expires in 15 minutes');
  console.warn('   Enter this token at the setup screen');
  console.warn('========================================\n');

  return NextResponse.json({ firstRun: true, tokenGenerated: true });
}

// POST - Validate a token
async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!_optionalChain([body, 'optionalAccess', _ => _.token])) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 });
  }

  const valid = await validateSetupToken(body.token);
  return NextResponse.json({ valid });
}

// CommonJS exports
exports.GET = GET;
exports.POST = POST;
