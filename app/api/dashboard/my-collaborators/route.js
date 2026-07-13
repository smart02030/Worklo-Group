 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }/**
 * API Route: My Collaborators Dashboard
 * Returns users sharing projects with the current user
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

    // Get projects user is assigned to (active projects only)
    const { data: userAssignments, error: assignmentError } = await supabase
      .from('project_assignments')
      .select(
        `
        project_id,
        projects(
          id,
          name,
          status
        )
      `,
      )
      .eq('user_id', userId)
      .is('removed_at', null);

    if (assignmentError) {
      logger.error('Error fetching user assignments', {}, assignmentError );
      return NextResponse.json({ error: 'Failed to fetch collaborators' }, { status: 500 });
    }

    // Filter to active projects only
    const activeProjectIds =
      _optionalChain([userAssignments
, 'optionalAccess', _ => _.filter, 'call', _2 => _2((a) => {
          const project = Array.isArray(a.projects) ? a.projects[0] : a.projects;
          return project && ['planning', 'in_progress', 'review'].includes(project.status);
        })
, 'access', _3 => _3.map, 'call', _4 => _4((a) => a.project_id)]) || [];

    // Create a map of projectId -> projectName
    const projectNameMap = new Map();
    _optionalChain([userAssignments, 'optionalAccess', _5 => _5.forEach, 'call', _6 => _6((a) => {
      const project = Array.isArray(a.projects) ? a.projects[0] : a.projects;
      if (project) {
        projectNameMap.set(a.project_id, project.name);
      }
    })]);

    if (activeProjectIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          collaborators: [],
          totalCollaborators: 0,
        },
      });
    }

    // Get all other users assigned to these projects
    // Use explicit FK reference to avoid ambiguity (user_id vs assigned_by)
    const { data: otherAssignments, error: otherError } = await supabase
      .from('project_assignments')
      .select(
        `
        project_id,
        user_id,
        user_profiles(
          id,
          name,
          email,
          image
        )
      `,
      )
      .in('project_id', activeProjectIds)
      .neq('user_id', userId)
      .is('removed_at', null);

    if (otherError) {
      logger.error('Error fetching other assignments', {}, otherError );
      return NextResponse.json({ error: 'Failed to fetch collaborators' }, { status: 500 });
    }

    // Build collaborator map
    const collaboratorMap = new Map();

    for (const assignment of otherAssignments || []) {
      const user = Array.isArray(assignment.user_profiles)
        ? assignment.user_profiles[0]
        : assignment.user_profiles;

      if (!user) continue;

      const existingCollaborator = collaboratorMap.get(user.id);
      const projectName = projectNameMap.get(assignment.project_id) || '';

      if (existingCollaborator) {
        existingCollaborator.sharedProjects++;
        if (projectName && !existingCollaborator.projectNames.includes(projectName)) {
          existingCollaborator.projectNames.push(projectName);
        }
      } else {
        collaboratorMap.set(user.id, {
          id: user.id,
          name: user.name || user.email,
          email: user.email,
          image: user.image,
          sharedProjects: 1,
          projectNames: projectName ? [projectName] : [],
        });
      }
    }

    // Get roles for collaborators
    const collaboratorIds = Array.from(collaboratorMap.keys());

    if (collaboratorIds.length > 0) {
      const { data: userRoles } = await supabase
        .from('user_roles')
        .select(
          `
          user_id,
          roles(
            name,
            departments(name)
          )
        `,
        )
        .in('user_id', collaboratorIds);

      // Add role/department info
      _optionalChain([userRoles, 'optionalAccess', _7 => _7.forEach, 'call', _8 => _8((ur) => {
        const collaborator = collaboratorMap.get(ur.user_id);
        if (collaborator) {
          const role = Array.isArray(ur.roles) ? ur.roles[0] : ur.roles;
          if (role) {
            collaborator.role = role.name;
            const dept = Array.isArray(role.departments) ? role.departments[0] : role.departments;
            collaborator.department = _optionalChain([dept, 'optionalAccess', _9 => _9.name]);
          }
        }
      })]);
    }

    // Convert to array and sort by shared projects count
    const collaborators = Array.from(collaboratorMap.values()).sort(
      (a, b) => b.sharedProjects - a.sharedProjects,
    );

    return NextResponse.json({
      success: true,
      data: {
        collaborators,
        totalCollaborators: collaborators.length,
      },
    });
  } catch (error) {
    logger.error('Error in GET /api/dashboard/my-collaborators', {}, error );
    return NextResponse.json(
      { error: 'Internal server error', message: (error ).message },
      { status: 500 },
    );
  }
}

// CommonJS exports
exports.dynamic = dynamic;
exports.GET = GET;
