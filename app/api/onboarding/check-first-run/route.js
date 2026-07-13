const { NextResponse } = require('next/server');
const { isFirstRun } = require('@/lib/onboarding/setup-token');
// GET - Just check if this is a first run (no token generation)
async function GET() {
  const firstRun = await isFirstRun();
  return NextResponse.json({ firstRun });
}

// CommonJS exports
exports.GET = GET;
