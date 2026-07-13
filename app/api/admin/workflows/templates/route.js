 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { createAdminSupabaseClient, getUserFromRequest } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { getWorkflowTemplates, getAllWorkflowTemplates, createWorkflowTemplate,  } = require('@/lib/workflow-service');
const { validateRequestBody, createWorkflowTemplateSchema } = require('@/lib/validation-schemas');
const { logger } = require('@/lib/debug-logger');
// GET /api/admin/workflows/templates - List all workflow templates
async function GET(request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminSupabaseClient();
    if (!admin) return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });

    const { data: userProfile } = await admin
      .from('user_profiles')
      .select(
        `*, user_roles!user_id(role_id, roles!role_id(id,name,permissions,department_id,is_system_role))`,
      )
      .eq('id', user.id)
      .single();

    if (!userProfile)
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });

    const canView = await hasPermission(userProfile, Permission.MANAGE_WORKFLOWS, undefined, admin);
    if (!canView) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

    const includeInactive = request.nextUrl.searchParams.get('include_inactive') === 'true';
    const templates = includeInactive
      ? await getAllWorkflowTemplates()
      : await getWorkflowTemplates();

    return NextResponse.json({ success: true, templates }, { status: 200 });
  } catch (error) {
    logger.error('Error in GET /api/admin/workflows/templates', {}, error );
    const err = error ;
    console.error(
      '[GET /api/admin/workflows/templates] ERROR:',
      _optionalChain([err, 'optionalAccess', _ => _.message]),
      _optionalChain([err, 'optionalAccess', _2 => _2.code]),
      _optionalChain([err, 'optionalAccess', _3 => _3.details]),
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/admin/workflows/templates - Create new workflow template
async function POST(request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminSupabaseClient();
    if (!admin) return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });

    const { data: userProfile, error: profileError } = await admin
      .from('user_profiles')
      .select(
        `*, user_roles!user_id(role_id, roles!role_id(id,name,permissions,department_id,is_system_role))`,
      )
      .eq('id', user.id)
      .single();

    console.log(
      '[POST templates] userProfile:',
      JSON.stringify({
        id: _optionalChain([userProfile, 'optionalAccess', _4 => _4.id]),
        is_superadmin: _optionalChain([userProfile, 'optionalAccess', _5 => _5.is_superadmin]),
        profileError: _optionalChain([profileError, 'optionalAccess', _6 => _6.message]),
      }),
    );

    if (!userProfile)
      return NextResponse.json(
        { error: 'User profile not found', details: _optionalChain([profileError, 'optionalAccess', _7 => _7.message]) },
        { status: 404 },
      );

    const canManage = await hasPermission(
      userProfile,
      Permission.MANAGE_WORKFLOWS,
      undefined,
      admin,
    );
    console.log('[POST templates] canManage:', canManage);
    if (!canManage)
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

    // Validate request body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const validation = validateRequestBody(createWorkflowTemplateSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Create template
    console.log('[POST /api/admin/workflows/templates] Creating template:', {
      name: validation.data.name,
      userId: user.id,
    });
    const template = await createWorkflowTemplate(
      validation.data.name,
      validation.data.description || null,
      user.id,
    );

    return NextResponse.json({ success: true, template }, { status: 201 });
  } catch (error) {
    const err = error ;
    console.error('[POST /api/admin/workflows/templates] ERROR:', {
      message: _optionalChain([err, 'optionalAccess', _8 => _8.message]),
      code: _optionalChain([err, 'optionalAccess', _9 => _9.code]),
      details: _optionalChain([err, 'optionalAccess', _10 => _10.details]),
      hint: _optionalChain([err, 'optionalAccess', _11 => _11.hint]),
      stack: _optionalChain([err, 'optionalAccess', _12 => _12.stack]),
    });
    logger.error(
      'Error in POST /api/admin/workflows/templates',
      {
        message: _optionalChain([err, 'optionalAccess', _13 => _13.message]),
        code: _optionalChain([err, 'optionalAccess', _14 => _14.code]),
        details: _optionalChain([err, 'optionalAccess', _15 => _15.details]),
        hint: _optionalChain([err, 'optionalAccess', _16 => _16.hint]),
      },
      error ,
    );
    return NextResponse.json(
      { error: _optionalChain([err, 'optionalAccess', _17 => _17.message]) || 'Internal server error', details: _optionalChain([err, 'optionalAccess', _18 => _18.details]) || _optionalChain([err, 'optionalAccess', _19 => _19.hint]) },
      { status: 500 },
    );
  }
}

// CommonJS exports
exports.GET = GET;
exports.POST = POST;
