 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }const { NextRequest, NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission, isSuperadmin } = require('@/lib/rbac');
const { Permission } = require('@/lib/permissions');
const { createProjectSchema, validateRequestBody } = require('@/lib/validation-schemas');
const { logger } = require('@/lib/debug-logger');
const { config } = require('@/lib/config');
// Type definitions
/**
 * POST /api/projects - Create a new project
 */
async function POST(request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminSupabaseClient();
    if (!admin) return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });

    // Get user profile with roles
    const { data: userProfile } = await admin
      .from('user_profiles')
      .select(`*, user_roles!user_id(roles!role_id(id,name,permissions,department_id))`)
      .eq('id', user.id)
      .single();

    if (!userProfile) {
      logger.error('User profile not found', { action: 'create_project', userId: user.id });
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Validate request body with Zod
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const validation = validateRequestBody(createProjectSchema, body);

    if (!validation.success) {
      logger.warn('Invalid project creation data', {
        action: 'create_project',
        userId: user.id,
        error: validation.error,
      });
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { accountId } = validation.data;

    // Check MANAGE_PROJECTS permission with account context (consolidated from CREATE_PROJECT)
    // CRITICAL: Pass authenticated supabase client for proper RLS context in permission checks
    const canManageProjects = await hasPermission(
      userProfile,
      Permission.MANAGE_PROJECTS,
      { accountId },
      admin,
    );
    if (!canManageProjects) {
      logger.warn('Insufficient permissions to create project', {
        action: 'create_project',
        userId: user.id,
        accountId,
      });
      return NextResponse.json(
        { error: 'Insufficient permissions to create projects' },
        { status: 403 },
      );
    }

    // Create the project
    const { data: project, error } = await admin
      .from('projects')
      .insert({
        name: validation.data.name,
        description: validation.data.description,
        account_id: accountId,
        status: validation.data.status || 'planning',
        start_date: validation.data.start_date,
        end_date: validation.data.end_date,
        budget: validation.data.budget,
        assigned_user_id: validation.data.assigned_user_id || user.id,
        created_by: user.id,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      logger.error(
        'Failed to create project in database',
        {
          action: 'create_project',
          userId: user.id,
          accountId,
        },
        error ,
      );

      return NextResponse.json(
        {
          error: 'Failed to create project',
          ...(config.errors.exposeDetails && { details: error.message }),
        },
        { status: 500 },
      );
    }

    // Add the creator as a team member in project_assignments
    const { error: assignmentError } = await admin.from('project_assignments').insert({
      project_id: project.id,
      user_id: user.id,
      role_in_project: 'Project Creator',
      assigned_at: new Date().toISOString(),
      assigned_by: user.id,
      source_type: 'creator',
    });

    if (assignmentError) {
      logger.error(
        'Failed to add creator to project assignments',
        {
          action: 'create_project',
          userId: user.id,
          projectId: project.id,
        },
        assignmentError ,
      );
      // Don't fail the request, the project was created successfully
    }

    logger.info('Project created successfully', {
      action: 'create_project',
      userId: user.id,
      projectId: project.id,
      accountId,
    });

    return NextResponse.json({ success: true, project }, { status: 201 });
  } catch (error) {
    logger.error('Error in POST /api/projects', { action: 'create_project' }, error );
    return NextResponse.json(
      {
        error: 'Internal server error',
        ...(config.errors.exposeDetails && { details: (error ).message }),
      },
      { status: 500 },
    );
  }
}
async function GET(request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminSupabaseClient();
    if (!admin) return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });

    // Get URL parameters
    const searchParams = request.nextUrl.searchParams;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam) : 10;

    const userId = user.id;

    // Get user profile with roles to check permissions
    const { data: userProfile } = await admin
      .from('user_profiles')
      .select(`*, user_roles!user_id(roles!role_id(id,name,permissions,department_id))`)
      .eq('id', userId)
      .single();

    if (!userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Check if user is superadmin (bypasses all permission checks)
    const userIsSuperadmin = isSuperadmin(userProfile);

    if (!userIsSuperadmin) {
      const canViewProjects = await hasPermission(
        userProfile,
        Permission.VIEW_PROJECTS,
        undefined,
        admin,
      );
      if (!canViewProjects) {
        return NextResponse.json(
          { error: 'Insufficient permissions to view projects' },
          { status: 403 },
        );
      }
    }

    const hasViewAllProjects =
      userIsSuperadmin ||
      (await hasPermission(userProfile, Permission.VIEW_ALL_PROJECTS, undefined, admin));

    // Build projects query
    let query = admin
      .from('projects')
      .select(
        `
        *,
        account:accounts(*)
      `,
      )
      .order('created_at', { ascending: false });

    if (!hasViewAllProjects) {
      // For users without VIEW_ALL_PROJECTS, ONLY show projects they're explicitly assigned to
      // This is stricter than RLS (which also allows viewing projects user created)
      // Dashboard should only show projects where user is a team member

      // Get project IDs from project_assignments (user is explicitly assigned)
      const { data: assignedProjects } = await admin
        .from('project_assignments')
        .select('project_id')
        .eq('user_id', userId)
        .is('removed_at', null);

      // Get project IDs from tasks (user has tasks assigned)
      const { data: taskProjects } = await admin
        .from('tasks')
        .select('project_id')
        .eq('assigned_to', userId);

      // Combine assigned project IDs only (NOT created_by)
      const assignedProjectIds = _optionalChain([assignedProjects, 'optionalAccess', _ => _.map, 'call', _2 => _2((p) => p.project_id)]) || [];
      const taskProjectIds = _optionalChain([taskProjects, 'optionalAccess', _3 => _3.map, 'call', _4 => _4((t) => t.project_id)]) || [];
      const allProjectIds = [...new Set([...assignedProjectIds, ...taskProjectIds])];

      // Only show projects user is explicitly assigned to
      if (allProjectIds.length > 0) {
        query = query.in('id', allProjectIds);
      } else {
        // No assigned projects - return empty
        return NextResponse.json({
          success: true,
          projects: [],
        });
      }
      query = query.limit(limit);
    }

    // Exclude completed projects - they go to "Finished Projects" on account page
    query = query.neq('status', 'complete');

    const { data: projects, error: queryError } = await query;

    if (queryError) {
      logger.error(
        'Failed to load projects',
        { action: 'get_projects', userId },
        queryError ,
      );
      return NextResponse.json(
        {
          error: 'Failed to load projects',
          ...(config.errors.exposeDetails && { details: queryError.message }),
        },
        { status: 500 },
      );
    }

    // Get departments for each project via project_assignments
    const projectIds = (projects || []).map((p) => p.id);
    const departmentsByProject = {};

    if (projectIds.length > 0) {
      // Fetch assignments and user roles in parallel
      const [assignmentsResult, tasksResult] = await Promise.all([
        admin
          .from('project_assignments')
          .select('project_id, user_id')
          .in('project_id', projectIds)
          .is('removed_at', null),
        admin
          .from('tasks')
          .select('project_id, remaining_hours, estimated_hours')
          .in('project_id', projectIds),
      ]);

      const { data: assignments } = assignmentsResult;
      const { data: tasksData } = tasksResult;

      if (assignments && assignments.length > 0) {
        const userIds = Array.from(new Set(assignments.map((a) => a.user_id)));

        // Fetch user roles
        const { data: userRoles } = await admin
          .from('user_roles')
          .select(
            `
            user_id,
            roles (
              department_id,
              departments (
                id,
                name
              )
            )
          `,
          )
          .in('user_id', userIds);

        // Build a map of user_id to departments
        const userDepartments = {};
        if (userRoles) {
          userRoles.forEach((ur) => {
            const userId = ur.user_id ;
            if (!userDepartments[userId]) {
              userDepartments[userId] = [];
            }
            const role = ur.roles ;
            const departments = _optionalChain([role, 'optionalAccess', _5 => _5.departments]) ;
            if (departments) {
              const exists = userDepartments[userId].some((d) => d.id === departments.id);
              if (!exists) {
                userDepartments[userId].push(departments);
              }
            }
          });
        }

        // Map departments to projects based on assigned users
        assignments.forEach((assignment) => {
          const projectId = assignment.project_id ;
          const userId = assignment.user_id ;

          if (!departmentsByProject[projectId]) {
            departmentsByProject[projectId] = [];
          }

          const depts = userDepartments[userId] || [];
          depts.forEach((dept) => {
            const exists = departmentsByProject[projectId].some((d) => d.id === dept.id);
            if (!exists) {
              departmentsByProject[projectId].push(dept);
            }
          });
        });
      }

      // Calculate remaining hours and task sum per project
      const projectRemainingHours = {};
      const projectTaskSum = {};
      if (tasksData) {
        tasksData.forEach((task) => {
          const projectId = task.project_id ;
          if (!projectRemainingHours[projectId]) {
            projectRemainingHours[projectId] = 0;
          }
          if (!projectTaskSum[projectId]) {
            projectTaskSum[projectId] = 0;
          }
          projectRemainingHours[projectId] +=
            (task.remaining_hours ) || (task.estimated_hours ) || 0;
          projectTaskSum[projectId] += (task.estimated_hours ) || 0;
        });
      }

      // Add departments and task data to projects
      const projectsWithDetails = (projects || []).map((project) => {
        const projectId = project.id ;
        return {
          ...project,
          account: project.account || null,
          departments: departmentsByProject[projectId] || [],
          remaining_hours: projectRemainingHours[projectId] || null,
          task_hours_sum: projectTaskSum[projectId] || 0,
        };
      });

      return NextResponse.json({
        success: true,
        projects: projectsWithDetails,
      });
    }

    return NextResponse.json({
      success: true,
      projects: projects || [],
    });
  } catch (error) {
    logger.error('Error in projects API', { action: 'get_projects' }, error );
    return NextResponse.json(
      {
        error: 'Internal server error',
        ...(config.errors.exposeDetails && { details: (error ).message }),
      },
      { status: 500 },
    );
  }
}

// CommonJS exports
exports.POST = POST;
exports.GET = GET;
