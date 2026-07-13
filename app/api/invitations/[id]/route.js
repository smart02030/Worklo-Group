 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { requireAuthentication, requirePermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
// DELETE - Revoke a pending invitation
async function DELETE(
  request,
  { params },
) {
  try {
    const { id } = await params;

    // Auth + permission check
    const user = await requireAuthentication(request);
    const supabase = createApiSupabaseClient(request);
    await requirePermission(user, Permission.MANAGE_USER_ROLES, {}, admin);

    // Use admin client to bypass RLS for invitation management
    const adminSupabase = createAdminSupabaseClient();
    if (!adminSupabase) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Verify invitation exists and is pending
    const { data: invitation, error: fetchError } = await adminSupabase
      .from('user_invitations')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError || !invitation) {
      logger.error('Invitation not found for revoke', {
        invitationId: id,
        error: _optionalChain([fetchError, 'optionalAccess', _ => _.message]),
      });
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    if (invitation.status === 'pending') {
      // Soft delete: revoke pending invitations
      const { data: updated, error: updateError } = await adminSupabase
        .from('user_invitations')
        .update({ status: 'revoked' })
        .eq('id', id)
        .select()
        .single();

      if (updateError) {
        logger.error('Failed to revoke invitation', {
          error: updateError.message,
          invitationId: id,
        });
        return NextResponse.json({ error: 'Failed to revoke invitation' }, { status: 500 });
      }

      return NextResponse.json({ invitation: updated });
    }

    // Hard delete: remove non-pending invitations (revoked, accepted, expired)
    const { error: deleteError } = await adminSupabase
      .from('user_invitations')
      .delete()
      .eq('id', id);

    if (deleteError) {
      logger.error('Failed to delete invitation', { error: deleteError.message, invitationId: id });
      return NextResponse.json({ error: 'Failed to delete invitation' }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return handleGuardError(error);
  }
}

// CommonJS exports
exports.DELETE = DELETE;
