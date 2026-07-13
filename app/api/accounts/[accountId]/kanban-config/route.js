const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient } = require('@/lib/supabase-server');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');
/**
 * GET /api/accounts/[accountId]/kanban-config
 * Get Kanban configuration for an account
 * NOTE: Kanban/Gantt for projects is deprecated (workflows replace it), but visual display still works
 */
async function GET(
  request,
  { params },
) {
  try {
    const { accountId } = await params;

    if (!isValidUUID(accountId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    // Require VIEW_PROJECTS permission (kanban view permissions are deprecated)
    await requireAuthAndPermission(Permission.VIEW_PROJECTS, { accountId }, request);

    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase client not available' }, { status: 500 });
    }

    const { data: config, error } = await supabase
      .from('account_kanban_configs')
      .select('*')
      .eq('account_id', accountId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No config found, return null (client will use defaults)
        return NextResponse.json({ config: null });
      }
      logger.error('Error fetching kanban config', {}, error );
      return NextResponse.json({ error: 'Failed to fetch kanban config' }, { status: 500 });
    }

    return NextResponse.json({ config });
  } catch (error) {
    logger.error('Error in GET /api/accounts/[accountId]/kanban-config', {}, error );
    return handleGuardError(error);
  }
}

/**
 * PUT /api/accounts/[accountId]/kanban-config
 * Update Kanban configuration for an account
 */
async function PUT(
  request,
  { params },
) {
  try {
    const { accountId } = await params;

    if (!isValidUUID(accountId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    // Authenticate before parsing body
    await requireAuthAndPermission(Permission.MANAGE_PROJECTS, { accountId }, request);

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { columns } = body;

    if (!columns || !Array.isArray(columns)) {
      return NextResponse.json({ error: 'Columns array is required' }, { status: 400 });
    }

    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase client not available' }, { status: 500 });
    }

    // Check if config exists
    const { data: existingConfig } = await supabase
      .from('account_kanban_configs')
      .select('id')
      .eq('account_id', accountId)
      .single();

    let config;
    if (existingConfig) {
      // Update existing config
      const { data, error } = await supabase
        .from('account_kanban_configs')
        .update({
          columns,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', accountId)
        .select()
        .single();

      if (error) {
        logger.error('Error updating kanban config', {}, error );
        return NextResponse.json({ error: 'Failed to update kanban config' }, { status: 500 });
      }
      config = data;
    } else {
      // Create new config
      const { data, error } = await supabase
        .from('account_kanban_configs')
        .insert({
          account_id: accountId,
          columns,
        })
        .select()
        .single();

      if (error) {
        logger.error('Error creating kanban config', {}, error );
        return NextResponse.json({ error: 'Failed to create kanban config' }, { status: 500 });
      }
      config = data;
    }

    return NextResponse.json({ success: true, config });
  } catch (error) {
    logger.error('Error in PUT /api/accounts/[accountId]/kanban-config', {}, error );
    return handleGuardError(error);
  }
}

// CommonJS exports
exports.GET = GET;
exports.PUT = PUT;
