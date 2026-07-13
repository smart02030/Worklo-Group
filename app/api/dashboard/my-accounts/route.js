 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }/**
 * API Route: My Accounts Dashboard
 * Returns accounts the user is a member of with project counts
 */
const { NextRequest, NextResponse } = require('next/server');
const { createApiSupabaseClient, getUserProfileFromRequest } = require('@/lib/supabase-server');
const { logger } = require('@/lib/debug-logger');
const dynamic = 'force-dynamic';









async function GET(request) {
  try {
    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection not available' }, { status: 500 });
    }

    const userProfile = await getUserProfileFromRequest(supabase);
    if (!userProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = userProfile.id;

    // Get accounts user is a member of
    const { data: memberships, error: membershipError } = await supabase
      .from('account_members')
      .select(
        `
        account_id,
        accounts(
          id,
          name,
          status
        )
      `,
      )
      .eq('user_id', userId);

    if (membershipError) {
      logger.error('Error fetching account memberships', {}, membershipError );
      return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 });
    }

    // Also check for accounts where user manages them
    const { data: managedAccounts } = await supabase
      .from('accounts')
      .select('id, name, status')
      .eq('account_manager_id', userId);

    // Combine unique accounts
    const accountMap = new Map();

    _optionalChain([memberships, 'optionalAccess', _ => _.forEach, 'call', _2 => _2((m) => {
      const account = Array.isArray(m.accounts) ? m.accounts[0] : m.accounts;
      if (account) {
        accountMap.set(account.id, account);
      }
    })]);

    _optionalChain([managedAccounts, 'optionalAccess', _3 => _3.forEach, 'call', _4 => _4((account) => {
      if (!accountMap.has(account.id)) {
        accountMap.set(account.id, account);
      }
    })]);

    // Also check project assignments for additional accounts
    const { data: projectAssignments } = await supabase
      .from('project_assignments')
      .select(
        `
        projects(
          account_id,
          accounts(id, name, status)
        )
      `,
      )
      .eq('user_id', userId)
      .is('removed_at', null);

    _optionalChain([projectAssignments, 'optionalAccess', _5 => _5.forEach, 'call', _6 => _6((pa) => {
      const project = Array.isArray(pa.projects) ? pa.projects[0] : pa.projects;
      if (_optionalChain([project, 'optionalAccess', _7 => _7.accounts])) {
        const account = Array.isArray(project.accounts) ? project.accounts[0] : project.accounts;
        if (account && !accountMap.has(account.id)) {
          accountMap.set(account.id, account);
        }
      }
    })]);

    const accountIds = Array.from(accountMap.keys());

    if (accountIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          accounts: [],
          totalAccounts: 0,
        },
      });
    }

    // Get project counts per account
    const { data: projects } = await supabase
      .from('projects')
      .select('id, account_id, status, updated_at')
      .in('account_id', accountIds);

    // Build account data with project counts
    const accountsWithProjects = [];

    for (const account of accountMap.values()) {
      const accountProjects = _optionalChain([projects, 'optionalAccess', _8 => _8.filter, 'call', _9 => _9((p) => p.account_id === account.id)]) || [];
      const activeProjects = accountProjects.filter((p) =>
        ['planning', 'in_progress', 'review'].includes(p.status),
      );

      // Find most recent activity
      const sortedByActivity = [...accountProjects].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );

      accountsWithProjects.push({
        id: account.id,
        name: account.name,
        status: account.status,
        projectCount: accountProjects.length,
        activeProjectCount: activeProjects.length,
        lastActivity: _optionalChain([sortedByActivity, 'access', _10 => _10[0], 'optionalAccess', _11 => _11.updated_at]),
      });
    }

    // Sort by active project count, then by name
    accountsWithProjects.sort((a, b) => {
      if (b.activeProjectCount !== a.activeProjectCount) {
        return b.activeProjectCount - a.activeProjectCount;
      }
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      success: true,
      data: {
        accounts: accountsWithProjects,
        totalAccounts: accountsWithProjects.length,
      },
    });
  } catch (error) {
    logger.error('Error in GET /api/dashboard/my-accounts', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.dynamic = dynamic;
exports.GET = GET;
