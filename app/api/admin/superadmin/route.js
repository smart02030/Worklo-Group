const { NextRequest, NextResponse } = require('next/server');
const { createAdminSupabaseClient, getUserProfileFromRequest, createApiSupabaseClient,  } = require('@/lib/supabase-server');
const { isSuperadmin } = require('@/lib/rbac');
const { logger } = require('@/lib/debug-logger');
async function POST(request) {
  try {
    const supabase = createApiSupabaseClient(request);
    const admin = createAdminSupabaseClient();
    if (!supabase || !admin) {
      return NextResponse.json({ error: 'Database connection not available' }, { status: 500 });
    }

    // Only superadmins can assign superadmin role
    const userProfile = await getUserProfileFromRequest(supabase, request);
    if (!userProfile || !isSuperadmin(userProfile )) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { email, action } = body; // action: 'assign' | 'remove'
    if (!email || !action) {
      return NextResponse.json({ error: 'Email and action are required' }, { status: 400 });
    }

    // Find target user
    const { data: userData, error: userError } = await admin
      .from('user_profiles')
      .select('id, email')
      .eq('email', email)
      .single();
    if (userError || !userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (action === 'assign') {
      // Ensure System Administration department exists
      let deptId;
      const { data: dept } = await admin
        .from('departments')
        .select('id')
        .eq('name', 'System Administration')
        .single();
      if (!dept) {
        const { data: newDept, error: deptErr } = await admin
          .from('departments')
          .insert({
            name: 'System Administration',
            description: 'System administration department',
          })
          .select('id')
          .single();
        if (deptErr || !newDept) {
          return NextResponse.json(
            { error: 'Failed to create System Administration department' },
            { status: 500 },
          );
        }
        deptId = newDept.id;
      } else {
        deptId = dept.id;
      }

      // Ensure Superadmin role exists
      let roleId;
      const { data: role } = await admin
        .from('roles')
        .select('id')
        .eq('name', 'Superadmin')
        .single();
      if (!role) {
        const { data: newRole, error: roleErr } = await admin
          .from('roles')
          .insert({
            name: 'Superadmin',
            description: 'Full system access',
            is_system_role: true,
            hierarchy_level: 100,
            display_order: 0,
            permissions: {},
            department_id: deptId,
          })
          .select('id')
          .single();
        if (roleErr || !newRole) {
          return NextResponse.json({ error: 'Failed to create Superadmin role' }, { status: 500 });
        }
        roleId = newRole.id;
      } else {
        roleId = role.id;
      }

      // Assign role if not already assigned
      const { data: existing } = await admin
        .from('user_roles')
        .select('id')
        .eq('user_id', userData.id)
        .eq('role_id', roleId)
        .single();
      if (!existing) {
        await admin.from('user_roles').insert({
          user_id: userData.id,
          role_id: roleId,
          assigned_at: new Date().toISOString(),
          assigned_by: userProfile.id,
        });
      }

      // Set is_superadmin flag
      await admin.from('user_profiles').update({ is_superadmin: true }).eq('id', userData.id);

      return NextResponse.json({ success: true, message: `Superadmin role assigned to ${email}` });
    } else if (action === 'remove') {
      const { data: role } = await admin
        .from('roles')
        .select('id')
        .eq('name', 'Superadmin')
        .single();
      if (role) {
        await admin.from('user_roles').delete().eq('user_id', userData.id).eq('role_id', role.id);
      }
      await admin.from('user_profiles').update({ is_superadmin: false }).eq('id', userData.id);
      return NextResponse.json({ success: true, message: `Superadmin role removed from ${email}` });
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    logger.error('Error in POST /api/admin/superadmin', {}, error );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// CommonJS exports
exports.POST = POST;
