 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextResponse, NextRequest } = require('next/server');
const { createApiSupabaseClient, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { requireAuthAndAnyPermission, requireAuthAndPermission, handleGuardError,  } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
async function GET(request) {
  try {
    // Check authentication and permission
    await requireAuthAndAnyPermission(
      [Permission.VIEW_DEPARTMENTS, Permission.VIEW_ALL_DEPARTMENTS],
      undefined,
      request,
    );

    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // Fetch all departments
    const { data: departments, error } = await supabase
      .from('departments')
      .select('id, name, description, created_at, updated_at')
      .order('name');

    if (error) {
      logger.error('Error fetching departments', {}, error );
      return NextResponse.json({ error: 'Failed to fetch departments' }, { status: 500 });
    }

    return NextResponse.json(departments || []);
  } catch (error) {
    return handleGuardError(error);
  }
}
async function POST(request) {
  try {
    // Check authentication and permission (consolidated from CREATE_DEPARTMENT)
    await requireAuthAndPermission(Permission.MANAGE_DEPARTMENTS, {}, request);

    const supabase = createAdminSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { name, description } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Department name is required' }, { status: 400 });
    }

    if (name.trim().length > 100) {
      return NextResponse.json(
        { error: 'Department name must be 100 characters or less' },
        { status: 400 },
      );
    }

    if (description !== undefined && description !== null) {
      if (typeof description !== 'string') {
        return NextResponse.json({ error: 'Description must be a string' }, { status: 400 });
      }
      if (description.length > 500) {
        return NextResponse.json(
          { error: 'Description must be 500 characters or less' },
          { status: 400 },
        );
      }
    }

    const { data, error } = await supabase
      .from('departments')
      .insert({
        name: name.trim(),
        description: _optionalChain([description, 'optionalAccess', _ => _.trim, 'call', _2 => _2()]) || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A department with this name already exists' },
          { status: 409 },
        );
      }
      logger.error('Error creating department', {}, error );
      console.error('[departments POST] Supabase insert error:', JSON.stringify(error));
      return NextResponse.json(
        { error: error.message || 'Failed to create department' },
        { status: 500 },
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[departments POST] Caught error:', error);
    return handleGuardError(error);
  }
}

// CommonJS exports
exports.GET = GET;
exports.POST = POST;
