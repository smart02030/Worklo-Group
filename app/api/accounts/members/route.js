 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient } = require('@/lib/supabase-server');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
// Type definitions





/**
 * GET /api/accounts/members
 * Get all accounts with their assigned members
 */
async function GET(request) {
  try {
    // Require VIEW_ALL_ACCOUNTS permission
    await requireAuthAndPermission(Permission.VIEW_ALL_ACCOUNTS, {}, request);

    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase client not available' }, { status: 500 });
    }

    // Get all accounts with account manager details
    const { data: accounts, error: accountsError } = await supabase
      .from('accounts')
      .select(
        `
        id,
        name,
        description,
        status,
        account_manager_id,
        account_manager:user_profiles(
          id,
          name,
          email,
          image
        )
      `,
      )
      .order('name');

    if (accountsError) {
      logger.error('Error fetching accounts', {}, accountsError );
      return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 });
    }

    // Get all account members with user details
    const { data: allMembers, error: membersError } = await supabase
      .from('account_members')
      .select(
        `
        id,
        user_id,
        account_id,
        created_at,
        user_profiles(
          id,
          name,
          email,
          image,
          user_roles!user_id(
            id,
            roles!role_id(
              id,
              name,
              department_id,
              departments(
                id,
                name
              )
            )
          )
        )
      `,
      )
      .order('created_at', { ascending: false });

    // Group members by account
    const accountsWithMembers = (accounts || []).map((account) => {
      // Handle case where account_members table doesn't exist
      if (membersError) {
        logger.error('Error fetching account members', {}, membersError );
        // If table doesn't exist, return empty members array
        if (
          membersError.code === 'PGRST116' ||
          membersError.code === '42P01' ||
          _optionalChain([membersError, 'access', _ => _.message, 'optionalAccess', _2 => _2.includes, 'call', _3 => _3('does not exist')])
        ) {
          logger.debug('account_members table does not exist, returning empty members', {});
          return {
            ...account,
            members: [],
            member_count: 0,
          };
        }
      }

      const members = (allMembers || []).filter((m) => m.account_id === account.id);

      const formattedMembers = members.map((member) => {
        const userProfile = member.user_profiles ;
        const userRoles = (_optionalChain([userProfile, 'optionalAccess', _4 => _4.user_roles]) ) || [];

        return {
          id: member.id,
          user_id: member.user_id,
          account_id: member.account_id,
          created_at: member.created_at,
          user: userProfile
            ? {
                id: userProfile.id,
                name: userProfile.name,
                email: userProfile.email,
                image: userProfile.image,
                roles: userRoles
                  .map((ur) => {
                    const role = ur.roles ;
                    const department = _optionalChain([role, 'optionalAccess', _5 => _5.departments]) ;
                    return {
                      id: _optionalChain([role, 'optionalAccess', _6 => _6.id]),
                      name: _optionalChain([role, 'optionalAccess', _7 => _7.name]),
                      department: department
                        ? {
                            id: department.id,
                            name: department.name,
                          }
                        : null,
                    };
                  })
                  .filter((r) => r.id), // Filter out any invalid roles
              }
            : null,
        };
      });

      return {
        ...account,
        members: formattedMembers,
        member_count: formattedMembers.length,
      };
    });

    return NextResponse.json({ accounts: accountsWithMembers });
  } catch (error) {
    logger.error('Error in GET /api/accounts/members', {}, error );
    return handleGuardError(error);
  }
}

// CommonJS exports
exports.GET = GET;
