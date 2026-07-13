 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }/**
 * API Route: Published newsletters (Welcome page)
 * GET: Return latest published newsletters with author profile attached.
 *
 * We serve this via the backend to avoid client-side RLS/relationship quirks
 * across different Supabase schema versions.
 */
const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest, createAdminSupabaseClient,  } = require('@/lib/supabase-server');
const { checkPermissionHybrid } = require('@/lib/permission-checker');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
const dynamic = 'force-dynamic';
async function GET(request) {
  try {
    const supabase = createApiSupabaseClient(request);
    const admin = createAdminSupabaseClient();
    if (!supabase || !admin) {
      return NextResponse.json({ error: 'Database connection not available' }, { status: 500 });
    }

    const userProfile = await getUserProfileFromRequest(supabase);
    if (!userProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canView = await checkPermissionHybrid(
      userProfile,
      Permission.VIEW_NEWSLETTERS,
      undefined,
      admin,
    );
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions to view newsletters' },
        { status: 403 },
      );
    }

    const { data: newsletters, error } = await admin
      .from('newsletters')
      .select('*')
      .eq('is_published', true)
      .order('published_at', { ascending: false })
      .limit(20);

    if (error) {
      logger.error('Error fetching published newsletters', {}, error );
      // Common dev/demo failure mode: schema drift (missing table/columns)
      // - 42P01: undefined_table
      // - 42703: undefined_column
      const code = _optionalChain([(error ), 'optionalAccess', _ => _.code]);
      if (code === '42P01' || code === '42703') {
        return NextResponse.json({ success: true, data: [] });
      }

      return NextResponse.json(
        {
          error: 'Failed to fetch newsletters',
          ...(process.env.NODE_ENV === 'development'
            ? { details: { code: _optionalChain([(error ), 'optionalAccess', _2 => _2.code]), message: _optionalChain([(error ), 'optionalAccess', _3 => _3.message]) } }
            : {}),
        },
        { status: 500 },
      );
    }

    const authorIds = Array.from(
      new Set((newsletters || []).map((n) => n.created_by).filter(Boolean)),
    );
    let profilesById = new Map();

    if (authorIds.length > 0) {
      const { data: profiles, error: profilesError } = await admin
        .from('user_profiles')
        .select('id, name, email, image')
        .in('id', authorIds);

      if (!profilesError) {
        profilesById = new Map((profiles || []).map((p) => [p.id, p]));
      }
    }

    const withAuthors = (newsletters || []).map((n) => ({
      ...n,
      user_profiles: profilesById.get(n.created_by),
    }));

    return NextResponse.json({ success: true, data: withAuthors });
  } catch (err) {
    logger.error('Error in GET /api/newsletters/published', {}, err );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.dynamic = dynamic;
exports.GET = GET;
