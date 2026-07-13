 function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } } function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient } = require('@/lib/supabase-server');
const { requireAuthentication, requireAuthAndPermission, PermissionError, handleGuardError,  } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { accountService } = require('@/lib/account-service');
const { isSuperadmin, hasPermission } = require('@/lib/rbac');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');
// Type definitions









































/**
 * GET /api/accounts/[accountId]/members
 * Get all members assigned to an account
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

    logger.debug(`[GET /api/accounts/${accountId}/members] Starting request`);

    // Create Supabase client once for the entire request
    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      logger.error('[GET /api/accounts/[accountId]/members] Supabase client not available');
      return NextResponse.json(
        {
          error: 'Database connection failed',
          details: 'Supabase client not available',
        },
        { status: 500 },
      );
    }

    // Check authentication and access to this account
    // Uses same access logic as account detail page for consistency
    try {
      const user = await requireAuthentication(request);
      logger.debug(`[GET /api/accounts/${accountId}/members] User authenticated`, {
        userId: user.id,
      });

      // Check if user is superadmin (bypasses all permission checks)
      const userIsSuperadmin = isSuperadmin(user);
      logger.debug(`[GET /api/accounts/${accountId}/members] Superadmin check`, {
        isSuperadmin: userIsSuperadmin,
      });

      let hasAccess = false;

      if (userIsSuperadmin) {
        hasAccess = true;
        logger.debug(
          `[GET /api/accounts/${accountId}/members] User is superadmin - access granted`,
        );
      } else {
        // Check if user has permission-based access using proper hasPermission function
        const hasViewAllAccounts = await hasPermission(
          user,
          Permission.VIEW_ALL_ACCOUNTS,
          undefined,
          admin,
        );
        const hasViewAccounts = await hasPermission(
          user,
          Permission.VIEW_ACCOUNTS,
          { accountId },
          admin,
        );

        logger.debug(`[GET /api/accounts/${accountId}/members] User permissions check`, {
          hasViewAllAccounts,
          hasViewAccounts,
        });

        if (hasViewAllAccounts) {
          hasAccess = true;
          logger.debug(
            `[GET /api/accounts/${accountId}/members] User has VIEW_ALL_ACCOUNTS permission`,
          );
        } else if (hasViewAccounts) {
          hasAccess = true;
          logger.debug(
            `[GET /api/accounts/${accountId}/members] User has VIEW_ACCOUNTS permission`,
          );
        }
      }

      // If no permission-based access, check service-level access
      // This uses the same logic as the account detail page
      if (!hasAccess) {
        const hasServiceAccess = await accountService.canUserAccessAccount(
          user.id,
          accountId,
          admin,
        );
        logger.debug(`[GET /api/accounts/${accountId}/members] Service-level access check`, {
          hasServiceAccess,
        });

        if (hasServiceAccess) {
          hasAccess = true;
          logger.debug(
            `[GET /api/accounts/${accountId}/members] User has service-level access (manager, member, or project access)`,
          );
        }
      }

      if (!hasAccess) {
        logger.debug(
          `[GET /api/accounts/${accountId}/members] User has no account access after all checks`,
        );
        throw new PermissionError("You don't have permission to view account members");
      }

      logger.debug(`[GET /api/accounts/${accountId}/members] Access granted`);
    } catch (authError) {
      const err = authError ;
      logger.error(
        '[GET /api/accounts/[accountId]/members] Authentication/permission error',
        {
          errorMessage: err.message,
          name: err.name,
          status: err.status,
        },
        err,
      );
      // Return proper JSON error response
      const status = err.status || (err.name === 'AuthenticationError' ? 401 : 403);
      const errorResponse = {
        error: err.name === 'AuthenticationError' ? 'Authentication required' : 'Access denied',
        status: status,
      };
      logger.debug(`[GET /api/accounts/${accountId}/members] Returning error response`, {
        errorResponse,
      });
      return NextResponse.json(errorResponse, { status });
    }

    // Get account members with user details and roles
    // Split into multiple queries to avoid nested PostgREST issues
    const { data: accountMembers, error: membersError } = await supabase
      .from('account_members')
      .select('id, user_id, account_id, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    if (membersError) {
      logger.error(
        '[GET /api/accounts/[accountId]/members] Error fetching account members',
        {
          errorMessage: membersError.message,
          code: membersError.code,
          details: membersError.details,
          hint: membersError.hint,
        },
        membersError ,
      );
      // If table doesn't exist (PGRST116 or 42P01), return empty array instead of error
      if (
        membersError.code === 'PGRST116' ||
        membersError.code === '42P01' ||
        _optionalChain([membersError, 'access', _ => _.message, 'optionalAccess', _2 => _2.includes, 'call', _3 => _3('does not exist')])
      ) {
        logger.debug(
          '[GET /api/accounts/[accountId]/members] account_members table does not exist, returning empty array',
        );
        return NextResponse.json({ members: [] });
      }
      logger.error(
        'Failed to fetch account members',
        { accountId },
        membersError ,
      );
      return NextResponse.json({ error: 'Failed to fetch account members' }, { status: 500 });
    }

    // Get user profiles for these members
    const userIds = (accountMembers || []).map((m) => m.user_id);
    let members = [];

    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('user_profiles')
        .select('id, name, email, image')
        .in('id', userIds);

      if (profilesError) {
        logger.error(
          '[GET /api/accounts/[accountId]/members] Error fetching user profiles',
          {},
          profilesError ,
        );
        // Continue with members but without user details
      }

      // Get user roles for these users
      const { data: userRolesData, error: rolesError } = await supabase
        .from('user_roles')
        .select(
          `
          id,
          user_id,
          roles(
            id,
            name,
            department_id,
            departments(
              id,
              name
            )
          )
        `,
        )
        .in('user_id', userIds);

      if (rolesError) {
        logger.error(
          '[GET /api/accounts/[accountId]/members] Error fetching user roles',
          {},
          rolesError ,
        );
        // Continue without roles
      }

      // Map everything together
      const profilesMap = new Map((profiles || []).map((p) => [p.id, p]));
      const rolesMap = new Map();
      ((userRolesData ) || []).forEach((ur) => {
        if (!rolesMap.has(ur.user_id)) {
          rolesMap.set(ur.user_id, []);
        }
        _optionalChain([rolesMap, 'access', _4 => _4.get, 'call', _5 => _5(ur.user_id), 'optionalAccess', _6 => _6.push, 'call', _7 => _7(ur)]);
      });

      members = (accountMembers || []).map((member) => {
        const profile = profilesMap.get(member.user_id);
        const userRoles = _nullishCoalesce(rolesMap.get(member.user_id), () => ( []));

        return {
          ...member,
          user_profiles: profile
            ? {
                ...profile,
                user_roles: userRoles,
              }
            : null,
        };
      });
    } else {
      members = (accountMembers || []).map((m) => ({ ...m, user_profiles: null }));
    }

    // Transform the data to include user roles
    const formattedMembers = (members || []).map((member) => {
      const userProfile = member.user_profiles;
      const userRoles = _optionalChain([userProfile, 'optionalAccess', _8 => _8.user_roles]) || [];

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
                  const role = ur.roles;
                  const department = _optionalChain([role, 'optionalAccess', _9 => _9.departments]);
                  return {
                    id: _optionalChain([role, 'optionalAccess', _10 => _10.id]),
                    name: _optionalChain([role, 'optionalAccess', _11 => _11.name]),
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

    logger.info(`[GET /api/accounts/${accountId}/members] Successfully returning members`, {
      count: formattedMembers.length,
    });
    return NextResponse.json({ members: formattedMembers });
  } catch (error) {
    const err = error ;
    logger.error(
      '[GET /api/accounts/[accountId]/members] Unexpected error',
      {
        errorMessage: err.message,
        name: err.name,
        status: err.status,
      },
      err,
    );
    // Ensure we always return proper JSON
    const errorResponse = {
      error: 'Internal server error',
      status: err.status || 500,
    };
    logger.debug('[GET /api/accounts/[accountId]/members] Returning unexpected error response', {
      errorResponse,
    });
    return NextResponse.json(errorResponse, { status: err.status || 500 });
  }
}

/**
 * POST /api/accounts/[accountId]/members
 * Assign a user to an account
 */
async function POST(
  request,
  { params },
) {
  try {
    const { accountId } = await params;

    if (!isValidUUID(accountId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Require permission to assign users to this specific account
    await requireAuthAndPermission(Permission.MANAGE_USERS_IN_ACCOUNTS, { accountId }, request);

    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase client not available' }, { status: 500 });
    }

    // Add user to account (handle duplicate gracefully via unique constraint)
    const { data, error } = await supabase
      .from('account_members')
      .insert({
        account_id: accountId,
        user_id: userId,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      logger.error('Error assigning user to account', {}, error );

      // Provide more detailed error messages with correct status codes
      if (error.code === '23505') {
        return NextResponse.json(
          {
            error: 'User is already assigned to this account',
          },
          { status: 400 },
        );
      }

      let errorMessage = 'Failed to assign user to account';
      if (error.code === '42P01' || _optionalChain([error, 'access', _12 => _12.message, 'optionalAccess', _13 => _13.includes, 'call', _14 => _14('does not exist')])) {
        errorMessage =
          'The account_members table does not exist. Please create it in your database.';
      }

      return NextResponse.json(
        {
          error: errorMessage,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ member: data, message: 'User assigned to account successfully' });
  } catch (error) {
    logger.error('Error in POST /api/accounts/[accountId]/members', {}, error );
    return handleGuardError(error);
  }
}

// CommonJS exports
exports.GET = GET;
exports.POST = POST;
