#!/usr/bin/env tsx
/**
 * Create Seed Users and Load User-Dependent Data
 *
 * This script:
 * 1. Creates 8 test users in local Supabase auth.users
 * 2. Updates user_profiles with bio/skills/is_superadmin
 * 3. Assigns roles to users
 * 4. Loads all user-dependent seed data (accounts, projects, tasks, etc.)
 *
 * All test users have the password: Test1234!
 *
 * Usage:
 *   1. Start local Supabase: npm run docker:start
 *   2. Reset database: npm run docker:reset
 *   3. Run this script: npx tsx scripts/create-seed-users.ts
 *
 * Or use: npm run docker:seed
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local from project root
function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), '.env.local');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env.local not found, rely on existing env vars
  }
}
loadEnv();

// Helper function to get Monday of the week (handles timezone correctly)
function getWeekStartDate(date: Date = new Date()): string {
  // Create a new date at noon to avoid timezone edge cases
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.getFullYear(), d.getMonth(), diff);
  const year = monday.getFullYear();
  const month = String(monday.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(monday.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
}

// Read connection config from environment (supports both cloud and local)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

// Helper to find working Supabase URL
async function findWorkingSupabaseClient(): Promise<{
  client: SupabaseClient;
  url: string;
} | null> {
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    const { error } = await client.from('departments').select('count').limit(1);
    if (!error) {
      return { client, url: SUPABASE_URL };
    }
    console.error('❌ Supabase query error:', error.message);
  } catch (e: unknown) {
    console.error('❌ Connection error:', e instanceof Error ? e.message : e);
  }
  return null;
}

// Test users matching specific UUIDs
const TEST_USERS = [
  {
    id: '11111111-1111-1111-1111-000000000001',
    email: 'superadmin@test.local',
    name: 'Super Admin',
    password: 'Test1234!',
    is_superadmin: true,
    bio: 'System administrator with full access to all features',
    skills: ['administration', 'management', 'system-architecture'],
    role_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', // Superadmin role
  },
  {
    id: '11111111-1111-1111-1111-000000000002',
    email: 'exec@test.local',
    name: 'Alex Executive',
    password: 'Test1234!',
    is_superadmin: false,
    bio: 'Executive Director overseeing all operations',
    skills: ['leadership', 'strategy', 'business-development'],
    role_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', // Executive Director
  },
  {
    id: '11111111-1111-1111-1111-000000000003',
    email: 'manager@test.local',
    name: 'Morgan Manager',
    password: 'Test1234!',
    is_superadmin: false,
    bio: 'Account Manager handling enterprise clients',
    skills: ['account-management', 'client-relations', 'project-planning'],
    role_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', // Account Manager
  },
  {
    id: '11111111-1111-1111-1111-000000000004',
    email: 'pm@test.local',
    name: 'Pat ProjectManager',
    password: 'Test1234!',
    is_superadmin: false,
    bio: 'Project Manager coordinating cross-functional teams',
    skills: ['project-management', 'agile', 'scrum', 'coordination'],
    role_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', // Project Manager
  },
  {
    id: '11111111-1111-1111-1111-000000000009',
    email: 'admin@test.local',
    name: 'Andy Admin',
    password: 'Test1234!',
    is_superadmin: false,
    bio: 'System Administrator managing workflows and user roles',
    skills: ['system-administration', 'workflow-design', 'user-management', 'analytics'],
    role_id: '77777777-7777-7777-7777-777777777777', // Admin
  },
  {
    id: '11111111-1111-1111-1111-000000000005',
    email: 'designer@test.local',
    name: 'Dana Designer',
    password: 'Test1234!',
    is_superadmin: false,
    bio: 'Senior Designer creating beautiful user experiences',
    skills: ['ui-design', 'ux-design', 'figma', 'adobe-creative-suite'],
    role_id: '10101010-1010-1010-1010-101010101010', // Senior Designer
  },
  {
    id: '11111111-1111-1111-1111-000000000006',
    email: 'dev@test.local',
    name: 'Dev Developer',
    password: 'Test1234!',
    is_superadmin: false,
    bio: 'Senior Developer building scalable applications',
    skills: ['typescript', 'react', 'node.js', 'postgresql', 'next.js'],
    role_id: '30303030-3030-3030-3030-303030303030', // Senior Developer
  },
  {
    id: '11111111-1111-1111-1111-000000000007',
    email: 'contributor@test.local',
    name: 'Casey Contributor',
    password: 'Test1234!',
    is_superadmin: false,
    bio: 'Part-time contributor supporting various projects',
    skills: ['content-writing', 'qa-testing', 'documentation'],
    role_id: '70707070-7070-7070-7070-707070707070', // Contributor
  },
  {
    id: '11111111-1111-1111-1111-000000000008',
    email: 'client@test.local',
    name: 'Chris Client',
    password: 'Test1234!',
    is_superadmin: false,
    bio: 'Client user from Meridian Financial Group',
    skills: [],
    role_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', // Client
  },
];

async function createSeedUsers() {
  console.log('🔐 Worklo Seed Data Setup\n');
  console.log('='.repeat(60));

  // Test connection with multiple URLs (Windows compatibility)
  console.log('\n📡 Step 1: Connecting to local Supabase...');

  const result = await findWorkingSupabaseClient();

  if (!result) {
    console.error('❌ Failed to connect to Supabase. Check your credentials in .env.local');
    process.exit(1);
  }

  const { client: supabase, url: workingUrl } = result;
  console.log(`✅ Connected to Supabase at ${workingUrl}\n`);

  // Step 2: Create auth users
  console.log('👥 Step 2: Creating auth users...');
  let usersCreated = 0;
  let usersExisted = 0;

  for (const user of TEST_USERS) {
    const { data, error } = await supabase.auth.admin.createUser({
      id: user.id,
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { name: user.name },
    });

    if (error) {
      if (error.message.includes('already been registered')) {
        usersExisted++;
      } else {
        console.error(`   ❌ Failed to create ${user.email}: ${error.message}`);
      }
    } else {
      usersCreated++;
    }
  }

  console.log(`   ✅ Created: ${usersCreated} users`);
  if (usersExisted > 0) {
    console.log(`   ℹ️  Already existed: ${usersExisted} users`);
  }

  // Wait for trigger to create profiles — verify they actually exist
  console.log('\n⏳ Waiting for profile triggers...');
  const maxWaitAttempts = 15;
  for (let attempt = 1; attempt <= maxWaitAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id')
      .in(
        'id',
        TEST_USERS.map((u) => u.id),
      );
    const foundCount = profiles?.length || 0;
    if (foundCount >= TEST_USERS.length) {
      console.log(`   ✅ All ${foundCount} profiles created by trigger`);
      break;
    }
    if (attempt === maxWaitAttempts) {
      console.log(
        `   ⚠️  Only ${foundCount}/${TEST_USERS.length} profiles found after ${maxWaitAttempts}s`,
      );
      console.log('   Creating missing profiles manually...');
      for (const user of TEST_USERS) {
        const exists = profiles?.some((p: { id: string }) => p.id === user.id);
        if (!exists) {
          await supabase.from('user_profiles').upsert({
            id: user.id,
            email: user.email,
            name: user.name,
          });
        }
      }
    } else if (attempt % 3 === 0) {
      console.log(
        `   Waiting... (${foundCount}/${TEST_USERS.length} profiles, attempt ${attempt}/${maxWaitAttempts})`,
      );
    }
  }

  // Step 3: Update user profiles
  console.log('\n📝 Step 3: Updating user profiles...');
  for (const user of TEST_USERS) {
    const { error } = await supabase
      .from('user_profiles')
      .update({
        name: user.name,
        bio: user.bio,
        skills: user.skills,
        is_superadmin: user.is_superadmin,
      })
      .eq('id', user.id);

    if (error) {
      console.error(`   ❌ Failed to update profile for ${user.email}: ${error.message}`);
    }
  }
  console.log('   ✅ Profiles updated');

  // Step 4: Assign roles
  console.log('\n🎭 Step 4: Assigning roles...');
  for (const user of TEST_USERS) {
    // Delete existing role assignment if any
    await supabase.from('user_roles').delete().eq('user_id', user.id);

    const { error } = await supabase.from('user_roles').insert({
      user_id: user.id,
      role_id: user.role_id,
    });

    if (error) {
      console.error(`   ❌ Failed to assign role for ${user.email}: ${error.message}`);
    }
  }
  console.log('   ✅ Roles assigned');

  // Step 5: Load user-dependent seed data
  console.log('\n📦 Step 5: Loading seed data...');
  await loadSeedData(supabase);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('🎉 Setup Complete!\n');
  console.log('📋 Test User Credentials (password for all: Test1234!)\n');
  for (const user of TEST_USERS) {
    console.log(`   ${user.email.padEnd(28)} - ${user.name}`);
  }
  console.log('\n🚀 Next steps:');
  console.log('   1. Start the app: npm run dev');
  console.log('   2. Open: http://localhost:3000');
  console.log('   3. Login with any test user');
  console.log('   4. Access Supabase Studio: http://127.0.0.1:54323\n');
}

async function loadSeedData(supabase: SupabaseClient) {
  // Departments
  console.log('   Loading departments...');
  await supabase.from('departments').upsert(
    [
      {
        id: 'de000000-0000-0000-0000-000000000001',
        name: 'Strategy',
        description: 'Business strategy, executive direction and company growth',
      },
      {
        id: 'de000000-0000-0000-0000-000000000002',
        name: 'Design',
        description: 'Creative, UX and visual design',
      },
      {
        id: 'de000000-0000-0000-0000-000000000003',
        name: 'Development',
        description: 'Software engineering and architecture',
      },
      {
        id: 'de000000-0000-0000-0000-000000000004',
        name: 'Marketing',
        description: 'Marketing, content and communications',
      },
      {
        id: 'de000000-0000-0000-0000-000000000005',
        name: 'Operations',
        description: 'Project coordination and client success',
      },
      {
        id: 'de000000-0000-0000-0000-000000000006',
        name: 'Sales',
        description: 'Business development, proposals and client acquisition',
      },
      {
        id: 'de000000-0000-0000-0000-000000000007',
        name: 'QA',
        description: 'Quality assurance, testing and delivery standards',
      },
    ],
    { onConflict: 'name' },
  );

  // Assign departments to roles
  await supabase
    .from('roles')
    .update({ department_id: 'de000000-0000-0000-0000-000000000001' })
    .in('name', ['Executive Director', 'Admin']);
  await supabase
    .from('roles')
    .update({ department_id: 'de000000-0000-0000-0000-000000000002' })
    .eq('name', 'Senior Designer');
  await supabase
    .from('roles')
    .update({ department_id: 'de000000-0000-0000-0000-000000000003' })
    .eq('name', 'Senior Developer');
  await supabase
    .from('roles')
    .update({ department_id: 'de000000-0000-0000-0000-000000000004' })
    .in('name', ['Contributor']);
  await supabase
    .from('roles')
    .update({ department_id: 'de000000-0000-0000-0000-000000000005' })
    .in('name', ['Account Manager', 'Project Manager']);

  // Accounts
  console.log('   Loading accounts...');
  await supabase.from('accounts').upsert([
    {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
      name: 'Meridian Financial Group',
      description:
        'Mid-market investment and wealth management firm undergoing a full digital transformation',
      service_tier: 'enterprise',
      account_manager_id: '11111111-1111-1111-1111-000000000003',
      status: 'active',
    },
    {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002',
      name: 'Vanta Health',
      description:
        'Series B health-tech startup building patient engagement and telehealth software',
      service_tier: 'premium',
      account_manager_id: '11111111-1111-1111-1111-000000000003',
      status: 'active',
    },
    {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000003',
      name: 'Harlow & Sons Bakery',
      description: 'Family-owned artisan bakery chain with 6 locations expanding into e-commerce',
      service_tier: 'basic',
      account_manager_id: '11111111-1111-1111-1111-000000000004',
      status: 'active',
    },
  ]);

  // Account members
  console.log('   Loading account members...');
  await supabase.from('account_members').upsert([
    {
      user_id: '11111111-1111-1111-1111-000000000003',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
    },
    {
      user_id: '11111111-1111-1111-1111-000000000004',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
    },
    {
      user_id: '11111111-1111-1111-1111-000000000005',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
    },
    {
      user_id: '11111111-1111-1111-1111-000000000006',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
    },
    {
      user_id: '11111111-1111-1111-1111-000000000003',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002',
    },
    {
      user_id: '11111111-1111-1111-1111-000000000005',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002',
    },
    {
      user_id: '11111111-1111-1111-1111-000000000006',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002',
    },
    {
      user_id: '11111111-1111-1111-1111-000000000004',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000003',
    },
    {
      user_id: '11111111-1111-1111-1111-000000000007',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000003',
    },
  ]);

  // Projects
  console.log('   Loading projects...');
  await supabase.from('projects').upsert([
    {
      id: 'ffffffff-0001-0002-0003-000000000001',
      name: 'Client Portal Redesign',
      description:
        'Full redesign of the investor-facing client portal — new information architecture, refreshed UI, and improved document access flows',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
      status: 'active',
      priority: 'high',
      start_date: '2025-01-15',
      end_date: '2025-03-15',
      estimated_hours: 200,
      created_by: '11111111-1111-1111-1111-000000000003',
      assigned_user_id: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: 'ffffffff-0001-0002-0003-000000000002',
      name: 'Q2 Demand Generation Campaign',
      description:
        'Multi-channel B2B campaign targeting CFOs and wealth managers — LinkedIn ads, email nurture sequences, and gated content assets',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
      status: 'planning',
      priority: 'medium',
      start_date: '2025-02-01',
      end_date: '2025-04-30',
      estimated_hours: 120,
      created_by: '11111111-1111-1111-1111-000000000003',
      assigned_user_id: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: 'ffffffff-0001-0002-0003-000000000003',
      name: 'Patient App MVP',
      description:
        'Cross-platform mobile app for appointment booking, secure messaging with care teams, and prescription refill requests',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002',
      status: 'active',
      priority: 'urgent',
      start_date: '2025-01-10',
      end_date: '2025-02-28',
      estimated_hours: 300,
      created_by: '11111111-1111-1111-1111-000000000003',
      assigned_user_id: '11111111-1111-1111-1111-000000000006',
    },
    {
      id: 'ffffffff-0001-0002-0003-000000000004',
      name: 'Brand Identity System',
      description:
        'Complete brand identity for Vanta Health — logo suite, color system, typography, iconography, and a 40-page brand guidelines document',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002',
      status: 'on_hold',
      priority: 'high',
      start_date: '2025-01-05',
      end_date: '2025-02-05',
      estimated_hours: 80,
      created_by: '11111111-1111-1111-1111-000000000003',
      assigned_user_id: '11111111-1111-1111-1111-000000000005',
    },
    {
      id: 'ffffffff-0001-0002-0003-000000000005',
      name: 'Social Media & Content Retainer',
      description:
        'Monthly content production and scheduling — 20 posts/month across Instagram and Facebook, plus monthly performance reporting',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000003',
      status: 'active',
      priority: 'low',
      start_date: '2025-01-01',
      end_date: '2025-12-31',
      estimated_hours: 240,
      created_by: '11111111-1111-1111-1111-000000000004',
      assigned_user_id: '11111111-1111-1111-1111-000000000007',
    },
    {
      id: 'ffffffff-0001-0002-0003-000000000006',
      name: 'Local SEO & Google Business Optimisation',
      description:
        'Keyword research, on-page SEO, Google Business Profile setup for all 6 locations, and citation building',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000003',
      status: 'complete',
      priority: 'medium',
      start_date: '2024-12-01',
      end_date: '2025-01-15',
      estimated_hours: 60,
      created_by: '11111111-1111-1111-1111-000000000004',
      assigned_user_id: '11111111-1111-1111-1111-000000000007',
    },
    {
      id: 'ffffffff-0001-0002-0003-000000000007',
      name: 'Internal Reporting Dashboard',
      description:
        'Internal tool for tracking weekly KPIs across all active accounts — no workflow, managed directly by the team',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
      status: 'active',
      priority: 'low',
      start_date: '2025-01-15',
      end_date: '2025-02-28',
      estimated_hours: 40,
      created_by: '11111111-1111-1111-1111-000000000003',
      assigned_user_id: '11111111-1111-1111-1111-000000000004',
    },
  ]);

  // Project assignments
  console.log('   Loading project assignments...');
  await supabase.from('project_assignments').upsert([
    {
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      user_id: '11111111-1111-1111-1111-000000000004',
      role_in_project: 'Project Manager',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      user_id: '11111111-1111-1111-1111-000000000005',
      role_in_project: 'Lead Designer',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      user_id: '11111111-1111-1111-1111-000000000006',
      role_in_project: 'Lead Developer',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000002',
      user_id: '11111111-1111-1111-1111-000000000004',
      role_in_project: 'Project Manager',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000002',
      user_id: '11111111-1111-1111-1111-000000000005',
      role_in_project: 'Creative Lead',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000003',
      user_id: '11111111-1111-1111-1111-000000000006',
      role_in_project: 'Tech Lead',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000003',
      user_id: '11111111-1111-1111-1111-000000000005',
      role_in_project: 'UI Designer',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000004',
      user_id: '11111111-1111-1111-1111-000000000005',
      role_in_project: 'Brand Designer',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000005',
      user_id: '11111111-1111-1111-1111-000000000007',
      role_in_project: 'Content Creator',
      assigned_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000006',
      user_id: '11111111-1111-1111-1111-000000000007',
      role_in_project: 'SEO Specialist',
      assigned_by: '11111111-1111-1111-1111-000000000004',
    },
    // Project 7: Internal Dashboard Tool - No workflow project
    {
      project_id: 'ffffffff-0001-0002-0003-000000000007',
      user_id: '11111111-1111-1111-1111-000000000004',
      role_in_project: 'Project Lead',
      assigned_by: '11111111-1111-1111-1111-000000000003',
    },
  ]);

  // Tasks
  console.log('   Loading tasks...');
  await supabase.from('tasks').upsert([
    // Designer tasks (user 5) — Client Portal Redesign
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000001',
      name: 'Portal Homepage Mockups',
      description:
        'High-fidelity designs for the new portal dashboard — portfolio summary, recent activity, and document quick-access',
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      status: 'in_progress',
      priority: 'high',
      estimated_hours: 16,
      remaining_hours: 8,
      assigned_to: '11111111-1111-1111-1111-000000000005',
      created_by: '11111111-1111-1111-1111-000000000004',
      due_date: '2025-02-15',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000002',
      name: 'Document Vault UI',
      description: 'Design the document library with folder structure, search, and preview panel',
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      status: 'done',
      priority: 'medium',
      estimated_hours: 8,
      remaining_hours: 0,
      assigned_to: '11111111-1111-1111-1111-000000000005',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000007',
      name: 'Campaign Creative Brief',
      description: 'Visual direction and copy framework for Q2 LinkedIn and email assets',
      project_id: 'ffffffff-0001-0002-0003-000000000002',
      status: 'done',
      priority: 'high',
      estimated_hours: 12,
      remaining_hours: 0,
      assigned_to: '11111111-1111-1111-1111-000000000005',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000008',
      name: 'Email Template Design',
      description: 'Responsive HTML email templates for the 4-part nurture sequence',
      project_id: 'ffffffff-0001-0002-0003-000000000002',
      status: 'in_progress',
      priority: 'medium',
      estimated_hours: 8,
      remaining_hours: 4,
      assigned_to: '11111111-1111-1111-1111-000000000005',
      created_by: '11111111-1111-1111-1111-000000000004',
      due_date: '2025-02-10',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000009',
      name: 'Logo Suite Design',
      description:
        'Primary, secondary, and icon-only logo variants in full colour, reversed, and monochrome',
      project_id: 'ffffffff-0001-0002-0003-000000000004',
      status: 'done',
      priority: 'urgent',
      estimated_hours: 20,
      remaining_hours: 0,
      assigned_to: '11111111-1111-1111-1111-000000000005',
      created_by: '11111111-1111-1111-1111-000000000005',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000010',
      name: 'Brand Guidelines Document',
      description:
        'Full brand book covering logo usage, colour palette, typography, photography style, and tone of voice',
      project_id: 'ffffffff-0001-0002-0003-000000000004',
      status: 'review',
      priority: 'high',
      estimated_hours: 12,
      remaining_hours: 3,
      assigned_to: '11111111-1111-1111-1111-000000000005',
      created_by: '11111111-1111-1111-1111-000000000005',
      due_date: '2025-02-05',
    },
    // Developer tasks (user 6) — Client Portal & Patient App
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000003',
      name: 'Portal Frontend Build',
      description:
        'Implement React components from approved designs — dashboard, document vault, and account settings',
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      status: 'todo',
      priority: 'high',
      estimated_hours: 40,
      remaining_hours: 40,
      assigned_to: '11111111-1111-1111-1111-000000000006',
      created_by: '11111111-1111-1111-1111-000000000004',
      due_date: '2025-03-01',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000004',
      name: 'Auth & Secure Messaging',
      description:
        'Implement biometric login, session management, and end-to-end encrypted patient-provider messaging',
      project_id: 'ffffffff-0001-0002-0003-000000000003',
      status: 'done',
      priority: 'urgent',
      estimated_hours: 24,
      remaining_hours: 0,
      assigned_to: '11111111-1111-1111-1111-000000000006',
      created_by: '11111111-1111-1111-1111-000000000006',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000005',
      name: 'Appointment Booking Screen',
      description:
        'Calendar-based booking flow with provider availability, appointment type selection, and confirmation emails',
      project_id: 'ffffffff-0001-0002-0003-000000000003',
      status: 'in_progress',
      priority: 'high',
      estimated_hours: 20,
      remaining_hours: 10,
      assigned_to: '11111111-1111-1111-1111-000000000006',
      created_by: '11111111-1111-1111-1111-000000000006',
      due_date: '2025-02-20',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000006',
      name: 'Prescription Refill Flow',
      description: 'In-app prescription refill request with pharmacy selection and status tracking',
      project_id: 'ffffffff-0001-0002-0003-000000000003',
      status: 'todo',
      priority: 'medium',
      estimated_hours: 16,
      remaining_hours: 16,
      assigned_to: '11111111-1111-1111-1111-000000000006',
      created_by: '11111111-1111-1111-1111-000000000006',
      due_date: '2025-02-28',
    },
    // Alex Executive tasks (user 2)
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000011',
      name: 'Q1 Portfolio Review',
      description:
        'Review project health across all active accounts and flag any at-risk deliverables for the leadership meeting',
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      status: 'in_progress',
      priority: 'high',
      estimated_hours: 8,
      remaining_hours: 4,
      assigned_to: '11111111-1111-1111-1111-000000000002',
      created_by: '11111111-1111-1111-1111-000000000002',
      due_date: '2025-01-31',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000012',
      name: 'Meridian Executive Presentation',
      description:
        'Prepare QBR deck for Meridian Financial Group — project progress, upcoming milestones, and Q2 scope proposal',
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      status: 'todo',
      priority: 'urgent',
      estimated_hours: 6,
      remaining_hours: 6,
      assigned_to: '11111111-1111-1111-1111-000000000002',
      created_by: '11111111-1111-1111-1111-000000000002',
      due_date: '2025-02-03',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000013',
      name: 'Vanta Health Budget Sign-off',
      description:
        'Review and approve the revised budget for the Patient App MVP following scope change request',
      project_id: 'ffffffff-0001-0002-0003-000000000003',
      status: 'review',
      priority: 'high',
      estimated_hours: 4,
      remaining_hours: 2,
      assigned_to: '11111111-1111-1111-1111-000000000002',
      created_by: '11111111-1111-1111-1111-000000000002',
      due_date: '2025-02-07',
    },
    // Morgan Manager tasks (user 3)
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000014',
      name: 'Meridian Monthly Account Review',
      description:
        'Compile account health scorecard — NPS, open issues, upcoming renewals, and upsell opportunities',
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      status: 'in_progress',
      priority: 'high',
      estimated_hours: 6,
      remaining_hours: 3,
      assigned_to: '11111111-1111-1111-1111-000000000003',
      created_by: '11111111-1111-1111-1111-000000000003',
      due_date: '2025-01-30',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000015',
      name: 'Vanta Health Onboarding Checklist',
      description:
        'Complete client onboarding — stakeholder introductions, Slack channel setup, access provisioning, and kickoff agenda',
      project_id: 'ffffffff-0001-0002-0003-000000000003',
      status: 'todo',
      priority: 'medium',
      estimated_hours: 10,
      remaining_hours: 10,
      assigned_to: '11111111-1111-1111-1111-000000000003',
      created_by: '11111111-1111-1111-1111-000000000003',
      due_date: '2025-02-14',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000016',
      name: 'Enterprise Tier Upgrade Proposal',
      description:
        'Prepare proposal to move Meridian from premium to enterprise tier — additional seats, priority support, and dedicated PM',
      project_id: 'ffffffff-0001-0002-0003-000000000002',
      status: 'in_progress',
      priority: 'medium',
      estimated_hours: 8,
      remaining_hours: 5,
      assigned_to: '11111111-1111-1111-1111-000000000003',
      created_by: '11111111-1111-1111-1111-000000000003',
      due_date: '2025-02-10',
    },
    // Pat ProjectManager tasks (user 4)
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000017',
      name: 'Sprint 3 Planning — Portal Redesign',
      description:
        'Define sprint goals, assign tasks, and update the project timeline following the design approval',
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      status: 'in_progress',
      priority: 'high',
      estimated_hours: 4,
      remaining_hours: 2,
      assigned_to: '11111111-1111-1111-1111-000000000004',
      created_by: '11111111-1111-1111-1111-000000000004',
      due_date: '2025-01-29',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000018',
      name: 'Cross-Project Resource Rebalance',
      description:
        'Review team capacity across all active projects and redistribute workload to prevent bottlenecks in February',
      project_id: 'ffffffff-0001-0002-0003-000000000002',
      status: 'todo',
      priority: 'medium',
      estimated_hours: 6,
      remaining_hours: 6,
      assigned_to: '11111111-1111-1111-1111-000000000004',
      created_by: '11111111-1111-1111-1111-000000000004',
      due_date: '2025-02-05',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000019',
      name: 'Weekly Status Report',
      description: 'Compile and send the weekly project status update to all account stakeholders',
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      status: 'in_progress',
      priority: 'low',
      estimated_hours: 3,
      remaining_hours: 1,
      assigned_to: '11111111-1111-1111-1111-000000000004',
      created_by: '11111111-1111-1111-1111-000000000004',
      due_date: '2025-01-27',
    },
    // Andy Admin tasks (user 9)
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000020',
      name: 'Approval Workflow Optimisation',
      description:
        'Streamline the Standard Project Delivery workflow — reduce approval steps from 3 to 2 based on team feedback',
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      status: 'in_progress',
      priority: 'medium',
      estimated_hours: 8,
      remaining_hours: 4,
      assigned_to: '11111111-1111-1111-1111-000000000009',
      created_by: '11111111-1111-1111-1111-000000000009',
      due_date: '2025-02-08',
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000021',
      name: 'Role Permissions Audit',
      description:
        'Review all role permission sets, identify over-privileged accounts, and update to principle of least privilege',
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      status: 'todo',
      priority: 'high',
      estimated_hours: 6,
      remaining_hours: 6,
      assigned_to: '11111111-1111-1111-1111-000000000009',
      created_by: '11111111-1111-1111-1111-000000000009',
      due_date: '2025-02-12',
    },
    // Contributor tasks (user 7)
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000022',
      name: 'Weekly Social Post Scheduling',
      description:
        'Write captions, select images, and schedule 5 posts across Instagram and Facebook for the coming week',
      project_id: 'ffffffff-0001-0002-0003-000000000005',
      status: 'in_progress',
      priority: 'low',
      estimated_hours: 4,
      remaining_hours: 2,
      assigned_to: '11111111-1111-1111-1111-000000000007',
      created_by: '11111111-1111-1111-1111-000000000004',
      due_date: '2025-01-31',
    },
  ]);

  // Workflow templates
  console.log('   Loading workflow templates...');
  await supabase.from('workflow_templates').upsert([
    {
      id: '00000001-0002-0003-0004-000000000001',
      name: 'Design & Delivery Approval',
      description:
        'Standard client project workflow — design phase, internal review, client approval, and final delivery',
      created_by: '11111111-1111-1111-1111-000000000002',
      is_active: true,
    },
    {
      id: '00000001-0002-0003-0004-000000000002',
      name: 'Content Production',
      description:
        'End-to-end content workflow — brief, copywriting, design, client sign-off, and publish',
      created_by: '11111111-1111-1111-1111-000000000002',
      is_active: true,
    },
  ]);

  // Workflow nodes - using current node types: start, role, approval, form, conditional, end
  // Note: 'department' and 'sync' node types are deprecated
  // Role IDs from seed.sql: Senior Designer: 10101010-..., Senior Developer: 30303030-..., Project Manager: ffffffff-...-ffffffffffff
  console.log('   Loading workflow nodes...');
  await supabase.from('workflow_nodes').upsert([
    // Design & Delivery Approval Workflow
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-000000000001',
      workflow_template_id: '00000001-0002-0003-0004-000000000001',
      node_type: 'start',
      label: 'Project Kickoff',
      position_x: 100,
      position_y: 100,
    },
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-000000000002',
      workflow_template_id: '00000001-0002-0003-0004-000000000001',
      node_type: 'role',
      label: 'Design Phase',
      entity_id: '10101010-1010-1010-1010-101010101010',
      position_x: 300,
      position_y: 100,
    },
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-000000000003',
      workflow_template_id: '00000001-0002-0003-0004-000000000001',
      node_type: 'approval',
      label: 'Internal Review',
      position_x: 500,
      position_y: 100,
    },
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-000000000004',
      workflow_template_id: '00000001-0002-0003-0004-000000000001',
      node_type: 'role',
      label: 'Development Phase',
      entity_id: '30303030-3030-3030-3030-303030303030',
      position_x: 700,
      position_y: 100,
    },
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-000000000005',
      workflow_template_id: '00000001-0002-0003-0004-000000000001',
      node_type: 'end',
      label: 'Client Delivery',
      position_x: 900,
      position_y: 100,
    },
    // Content Production Workflow
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-000000000006',
      workflow_template_id: '00000001-0002-0003-0004-000000000002',
      node_type: 'start',
      label: 'Brief Received',
      position_x: 100,
      position_y: 200,
    },
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-000000000007',
      workflow_template_id: '00000001-0002-0003-0004-000000000002',
      node_type: 'role',
      label: 'Copywriting',
      entity_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      position_x: 300,
      position_y: 200,
    },
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-000000000008',
      workflow_template_id: '00000001-0002-0003-0004-000000000002',
      node_type: 'approval',
      label: 'Client Sign-off',
      position_x: 500,
      position_y: 200,
    },
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-000000000009',
      workflow_template_id: '00000001-0002-0003-0004-000000000002',
      node_type: 'role',
      label: 'Design & Assets',
      entity_id: '10101010-1010-1010-1010-101010101010',
      position_x: 700,
      position_y: 200,
    },
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-000000000010',
      workflow_template_id: '00000001-0002-0003-0004-000000000002',
      node_type: 'role',
      label: 'Scheduling & Publish',
      entity_id: '30303030-3030-3030-3030-303030303030',
      position_x: 900,
      position_y: 200,
    },
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-000000000011',
      workflow_template_id: '00000001-0002-0003-0004-000000000002',
      node_type: 'end',
      label: 'Published',
      position_x: 1100,
      position_y: 200,
    },
  ]);

  // Workflow connections
  console.log('   Loading workflow connections...');
  await supabase.from('workflow_connections').upsert([
    {
      workflow_template_id: '00000001-0002-0003-0004-000000000001',
      from_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000001',
      to_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000002',
      label: 'Begin Design',
    },
    {
      workflow_template_id: '00000001-0002-0003-0004-000000000001',
      from_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000002',
      to_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000003',
      label: 'Submit for Review',
    },
    {
      workflow_template_id: '00000001-0002-0003-0004-000000000001',
      from_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000003',
      to_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000004',
      label: 'Approved',
    },
    {
      workflow_template_id: '00000001-0002-0003-0004-000000000001',
      from_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000004',
      to_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000005',
      label: 'Build Complete',
    },
    {
      workflow_template_id: '00000001-0002-0003-0004-000000000002',
      from_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000006',
      to_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000007',
      label: 'Brief Confirmed',
    },
    {
      workflow_template_id: '00000001-0002-0003-0004-000000000002',
      from_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000007',
      to_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000008',
      label: 'Copy Ready',
    },
    {
      workflow_template_id: '00000001-0002-0003-0004-000000000002',
      from_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000008',
      to_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000009',
      label: 'Client Approved',
    },
    {
      workflow_template_id: '00000001-0002-0003-0004-000000000002',
      from_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000009',
      to_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000010',
      label: 'Assets Ready',
    },
    {
      workflow_template_id: '00000001-0002-0003-0004-000000000002',
      from_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000010',
      to_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000011',
      label: 'Scheduled',
    },
  ]);

  // Workflow instances (attach workflows to 5 of 6 projects - leave SEO Optimization without workflow)
  console.log('   Loading workflow instances...');
  const { error: wiError } = await supabase.from('workflow_instances').upsert([
    // Project 1: Website Redesign - Blog Post Approval workflow
    {
      id: 'bbbbbbbb-cccc-dddd-eeee-000000000001',
      workflow_template_id: '00000001-0002-0003-0004-000000000001',
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      current_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000002',
      status: 'active',
    },
    // Project 2: Marketing Campaign - Blog Post Approval workflow
    {
      id: 'bbbbbbbb-cccc-dddd-eeee-000000000002',
      workflow_template_id: '00000001-0002-0003-0004-000000000001',
      project_id: 'ffffffff-0001-0002-0003-000000000002',
      current_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000001', // At start
      status: 'active',
    },
    // Project 3: Mobile App MVP - Video Production workflow
    {
      id: 'bbbbbbbb-cccc-dddd-eeee-000000000003',
      workflow_template_id: '00000001-0002-0003-0004-000000000002',
      project_id: 'ffffffff-0001-0002-0003-000000000003',
      current_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000009',
      status: 'active',
    },
    // Project 4: Brand Identity - Blog Post Approval workflow
    {
      id: 'bbbbbbbb-cccc-dddd-eeee-000000000004',
      workflow_template_id: '00000001-0002-0003-0004-000000000001',
      project_id: 'ffffffff-0001-0002-0003-000000000004',
      current_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000004', // At Graphic Designer
      status: 'active',
    },
    // Project 5: Social Media Management - Video Production workflow
    {
      id: 'bbbbbbbb-cccc-dddd-eeee-000000000005',
      workflow_template_id: '00000001-0002-0003-0004-000000000002',
      project_id: 'ffffffff-0001-0002-0003-000000000005',
      current_node_id: 'aaaaaaaa-bbbb-cccc-dddd-000000000007', // At Script Writer
      status: 'active',
    },
    // Project 6: SEO Optimization - NO WORKFLOW (complete project, shows what a project without workflow looks like)
  ]);
  if (wiError) console.error('   Workflow instances error:', wiError);

  // User availability (for capacity charts) - 6 weeks of historical data with random availability
  console.log('   Loading user availability...');

  // Helper to get week start for N weeks ago
  const getWeekStartNWeeksAgo = (weeksAgo: number) => {
    const date = new Date();
    date.setDate(date.getDate() - weeksAgo * 7);
    return getWeekStartDate(date);
  };

  // Random availability between 20-40 hours (realistic working hours)
  const randomAvailability = () => Math.floor(Math.random() * 21) + 20; // 20-40

  // User IDs
  const users = [
    '11111111-1111-1111-1111-000000000004', // Project Manager
    '11111111-1111-1111-1111-000000000005', // Senior Designer
    '11111111-1111-1111-1111-000000000006', // Senior Developer
    '11111111-1111-1111-1111-000000000007', // Intern
  ];

  const availabilityData: { user_id: string; week_start_date: string; available_hours: number }[] =
    [];

  // Generate 6 weeks of availability data (current week + 5 past weeks)
  for (let weekOffset = 0; weekOffset < 6; weekOffset++) {
    const weekStart = getWeekStartNWeeksAgo(weekOffset);
    for (const userId of users) {
      // Intern gets lower hours (15-25)
      const hours = userId.endsWith('000000000007')
        ? Math.floor(Math.random() * 11) + 15 // 15-25
        : randomAvailability(); // 20-40
      availabilityData.push({
        user_id: userId,
        week_start_date: weekStart,
        available_hours: hours,
      });
    }
  }

  await supabase.from('user_availability').upsert(availabilityData);

  // Time entries (for capacity charts) - multiple weeks of realistic time logging
  console.log('   Loading time entries...');

  // Helper to get a date N days ago (formatted as YYYY-MM-DD in local timezone)
  const getDateNDaysAgo = (daysAgo: number) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Helper to get week start for a specific date (handles timezone correctly)
  const getWeekStartForDate = (dateStr: string) => {
    // Parse YYYY-MM-DD format correctly in local timezone
    const [year, month, day] = dateStr.split('-').map(Number);
    return getWeekStartDate(new Date(year, month - 1, day));
  };

  const timeEntries: {
    user_id: string;
    task_id: string;
    project_id: string;
    hours_logged: number;
    entry_date: string;
    week_start_date: string;
    description: string;
  }[] = [];

  // Task-User-Project mapping for realistic entries WITH estimated hours
  // This ensures time entries don't exceed reasonable bounds
  const taskAssignments = [
    // Designer tasks (user 5)
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000001',
      userId: '11111111-1111-1111-1111-000000000005',
      projectId: 'ffffffff-0001-0002-0003-000000000001',
      desc: 'Homepage design work',
      estimatedHours: 16,
    },
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000002',
      userId: '11111111-1111-1111-1111-000000000005',
      projectId: 'ffffffff-0001-0002-0003-000000000001',
      desc: 'About page design',
      estimatedHours: 8,
    },
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000007',
      userId: '11111111-1111-1111-1111-000000000005',
      projectId: 'ffffffff-0001-0002-0003-000000000002',
      desc: 'Content calendar',
      estimatedHours: 12,
    },
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000008',
      userId: '11111111-1111-1111-1111-000000000005',
      projectId: 'ffffffff-0001-0002-0003-000000000002',
      desc: 'Email campaign design',
      estimatedHours: 8,
    },
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000009',
      userId: '11111111-1111-1111-1111-000000000005',
      projectId: 'ffffffff-0001-0002-0003-000000000004',
      desc: 'Logo design concepts',
      estimatedHours: 20,
    },
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000010',
      userId: '11111111-1111-1111-1111-000000000005',
      projectId: 'ffffffff-0001-0002-0003-000000000004',
      desc: 'Brand guidelines',
      estimatedHours: 12,
    },
    // Developer tasks (user 6)
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000003',
      userId: '11111111-1111-1111-1111-000000000006',
      projectId: 'ffffffff-0001-0002-0003-000000000001',
      desc: 'Frontend implementation',
      estimatedHours: 40,
    },
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000004',
      userId: '11111111-1111-1111-1111-000000000006',
      projectId: 'ffffffff-0001-0002-0003-000000000003',
      desc: 'Auth implementation',
      estimatedHours: 24,
    },
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000005',
      userId: '11111111-1111-1111-1111-000000000006',
      projectId: 'ffffffff-0001-0002-0003-000000000003',
      desc: 'Dashboard progress',
      estimatedHours: 20,
    },
    // Alex Executive tasks (user 2)
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000011',
      userId: '11111111-1111-1111-1111-000000000002',
      projectId: 'ffffffff-0001-0002-0003-000000000001',
      desc: 'Strategy review work',
      estimatedHours: 8,
    },
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000012',
      userId: '11111111-1111-1111-1111-000000000002',
      projectId: 'ffffffff-0001-0002-0003-000000000001',
      desc: 'Executive briefing prep',
      estimatedHours: 6,
    },
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000013',
      userId: '11111111-1111-1111-1111-000000000002',
      projectId: 'ffffffff-0001-0002-0003-000000000003',
      desc: 'Budget review',
      estimatedHours: 4,
    },
    // Morgan Manager tasks (user 3)
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000014',
      userId: '11111111-1111-1111-1111-000000000003',
      projectId: 'ffffffff-0001-0002-0003-000000000001',
      desc: 'Account review',
      estimatedHours: 6,
    },
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000015',
      userId: '11111111-1111-1111-1111-000000000003',
      projectId: 'ffffffff-0001-0002-0003-000000000003',
      desc: 'Client onboarding',
      estimatedHours: 10,
    },
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000016',
      userId: '11111111-1111-1111-1111-000000000003',
      projectId: 'ffffffff-0001-0002-0003-000000000002',
      desc: 'Upsell proposal work',
      estimatedHours: 8,
    },
    // Pat ProjectManager tasks (user 4)
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000017',
      userId: '11111111-1111-1111-1111-000000000004',
      projectId: 'ffffffff-0001-0002-0003-000000000001',
      desc: 'Sprint planning',
      estimatedHours: 4,
    },
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000018',
      userId: '11111111-1111-1111-1111-000000000004',
      projectId: 'ffffffff-0001-0002-0003-000000000002',
      desc: 'Resource allocation',
      estimatedHours: 6,
    },
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000019',
      userId: '11111111-1111-1111-1111-000000000004',
      projectId: 'ffffffff-0001-0002-0003-000000000001',
      desc: 'Status report',
      estimatedHours: 3,
    },
    // Andy Admin tasks (user 9)
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000020',
      userId: '11111111-1111-1111-1111-000000000009',
      projectId: 'ffffffff-0001-0002-0003-000000000001',
      desc: 'Workflow optimization',
      estimatedHours: 8,
    },
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000021',
      userId: '11111111-1111-1111-1111-000000000009',
      projectId: 'ffffffff-0001-0002-0003-000000000001',
      desc: 'Permission audit',
      estimatedHours: 6,
    },
    // Contributor tasks (user 7)
    {
      taskId: 'cccccccc-dddd-eeee-ffff-000000000022',
      userId: '11111111-1111-1111-1111-000000000007',
      projectId: 'ffffffff-0001-0002-0003-000000000005',
      desc: 'Social post scheduling',
      estimatedHours: 4,
    },
  ];

  // Track logged hours per task to avoid over-logging
  const taskLoggedHours: Record<string, number> = {};
  taskAssignments.forEach((t) => (taskLoggedHours[t.taskId] = 0));

  // Generate time entries for the past 35 days (5 weeks) - skip weekends
  // Iterate from oldest to newest so we can stop when task is "complete"
  for (let dayOffset = 34; dayOffset >= 0; dayOffset--) {
    const entryDate = getDateNDaysAgo(dayOffset);
    const dateObj = new Date(entryDate);
    const dayOfWeek = dateObj.getDay();

    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const weekStart = getWeekStartForDate(entryDate);

    // Each user logs 1-3 entries per day with varying hours
    for (const assignment of taskAssignments) {
      // Skip if task has already reached ~90% of estimate
      const maxHours = assignment.estimatedHours * 0.9;
      if (taskLoggedHours[assignment.taskId] >= maxHours) continue;

      // 40% chance of logging time on any given task-day (reduced from 60%)
      if (Math.random() > 0.4) continue;

      // Random hours between 1-6, weighted towards 2-4
      const baseHours = Math.random() > 0.3 ? Math.random() * 2 + 2 : Math.random() * 5 + 1;
      const remainingEstimate = maxHours - taskLoggedHours[assignment.taskId];
      const hours = Math.min(
        Math.round(baseHours * 10) / 10, // Round to 1 decimal
        8, // Cap at 8 hours per entry
        remainingEstimate, // Don't exceed estimated hours
      );

      if (hours <= 0) continue;

      taskLoggedHours[assignment.taskId] += hours;

      timeEntries.push({
        user_id: assignment.userId,
        task_id: assignment.taskId,
        project_id: assignment.projectId,
        hours_logged: hours,
        entry_date: entryDate,
        week_start_date: weekStart,
        description: assignment.desc,
      });
    }
  }

  await supabase.from('time_entries').upsert(timeEntries);

  // Task week allocations (for capacity planning) - multiple weeks
  console.log('   Loading task week allocations...');

  const taskAllocations: {
    task_id: string;
    week_start_date: string;
    allocated_hours: number;
    assigned_user_id: string;
  }[] = [];

  // Generate allocations for 4 weeks (current + 3 past)
  for (let weekOffset = 0; weekOffset < 4; weekOffset++) {
    const weekStart = getWeekStartNWeeksAgo(weekOffset);

    // Allocations for Senior Designer (user 5)
    taskAllocations.push(
      {
        task_id: 'cccccccc-dddd-eeee-ffff-000000000001',
        week_start_date: weekStart,
        allocated_hours: 16,
        assigned_user_id: '11111111-1111-1111-1111-000000000005',
      },
      {
        task_id: 'cccccccc-dddd-eeee-ffff-000000000008',
        week_start_date: weekStart,
        allocated_hours: 8,
        assigned_user_id: '11111111-1111-1111-1111-000000000005',
      },
    );

    // Allocations for Senior Developer (user 6)
    taskAllocations.push(
      {
        task_id: 'cccccccc-dddd-eeee-ffff-000000000003',
        week_start_date: weekStart,
        allocated_hours: 20,
        assigned_user_id: '11111111-1111-1111-1111-000000000006',
      },
      {
        task_id: 'cccccccc-dddd-eeee-ffff-000000000005',
        week_start_date: weekStart,
        allocated_hours: 16,
        assigned_user_id: '11111111-1111-1111-1111-000000000006',
      },
    );

    // Allocations for Alex Executive (user 2)
    taskAllocations.push(
      {
        task_id: 'cccccccc-dddd-eeee-ffff-000000000011',
        week_start_date: weekStart,
        allocated_hours: 8,
        assigned_user_id: '11111111-1111-1111-1111-000000000002',
      },
      {
        task_id: 'cccccccc-dddd-eeee-ffff-000000000013',
        week_start_date: weekStart,
        allocated_hours: 4,
        assigned_user_id: '11111111-1111-1111-1111-000000000002',
      },
    );

    // Allocations for Morgan Manager (user 3)
    taskAllocations.push(
      {
        task_id: 'cccccccc-dddd-eeee-ffff-000000000014',
        week_start_date: weekStart,
        allocated_hours: 6,
        assigned_user_id: '11111111-1111-1111-1111-000000000003',
      },
      {
        task_id: 'cccccccc-dddd-eeee-ffff-000000000016',
        week_start_date: weekStart,
        allocated_hours: 8,
        assigned_user_id: '11111111-1111-1111-1111-000000000003',
      },
    );

    // Allocations for Pat ProjectManager (user 4)
    taskAllocations.push(
      {
        task_id: 'cccccccc-dddd-eeee-ffff-000000000017',
        week_start_date: weekStart,
        allocated_hours: 4,
        assigned_user_id: '11111111-1111-1111-1111-000000000004',
      },
      {
        task_id: 'cccccccc-dddd-eeee-ffff-000000000019',
        week_start_date: weekStart,
        allocated_hours: 3,
        assigned_user_id: '11111111-1111-1111-1111-000000000004',
      },
    );

    // Allocations for Andy Admin (user 9)
    taskAllocations.push(
      {
        task_id: 'cccccccc-dddd-eeee-ffff-000000000020',
        week_start_date: weekStart,
        allocated_hours: 8,
        assigned_user_id: '11111111-1111-1111-1111-000000000009',
      },
      {
        task_id: 'cccccccc-dddd-eeee-ffff-000000000021',
        week_start_date: weekStart,
        allocated_hours: 6,
        assigned_user_id: '11111111-1111-1111-1111-000000000009',
      },
    );

    // Allocations for Contributor (user 7)
    taskAllocations.push({
      task_id: 'cccccccc-dddd-eeee-ffff-000000000022',
      week_start_date: weekStart,
      allocated_hours: 4,
      assigned_user_id: '11111111-1111-1111-1111-000000000007',
    });
  }

  await supabase.from('task_week_allocations').upsert(taskAllocations);

  // Newsletters
  console.log('   Loading newsletters...');
  await supabase.from('newsletters').upsert([
    {
      id: 'eeeeeeee-ffff-0001-0002-000000000001',
      title: 'March Agency Update — New Clients, Team News & Q2 Planning',
      content: `We closed two new accounts this month — welcome to Vanta Health and Harlow & Sons Bakery. Both kick off in the next two weeks.\n\nOn the team side, Dana has been promoted to Lead Designer effective April 1st. Please join us in congratulating her.\n\nQ2 planning sessions start next Monday. All project leads should have their capacity estimates submitted by Friday EOD.\n\nA reminder that the new approval workflow is live for all active projects. If you run into any issues, reach out to Andy in the #workflows Slack channel.`,
      created_by: '11111111-1111-1111-1111-000000000002',
      is_published: true,
      published_at: '2025-01-15T10:00:00Z',
    },
    {
      id: 'eeeeeeee-ffff-0001-0002-000000000002',
      title: "Q2 2025 Roadmap — What We're Building Next",
      content: `Here is what the team is focused on in Q2:\n\n**Client Work**\nMeridian Financial Group portal goes into development in April. Vanta Health app beta is targeting a May release. Harlow & Sons e-commerce integration kicks off in late April.\n\n**Internal Improvements**\nWe are rolling out time tracking improvements based on your feedback — easier week navigation and bulk entry. The new capacity planning view will also be available in April.\n\n**Hiring**\nWe are actively recruiting a mid-level developer and a junior designer. If you know anyone great, please send referrals to Morgan.\n\nFull roadmap details are in Notion. Questions? Bring them to the all-hands on the 14th.`,
      created_by: '11111111-1111-1111-1111-000000000002',
      is_published: false,
    },
  ]);

  // Project Updates (for welcome page and project details)
  console.log('   Loading project updates...');
  await supabase.from('project_updates').upsert([
    {
      id: 'dddddddd-0001-0002-0003-000000000001',
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      content:
        'Portal homepage and document vault designs approved by Meridian stakeholders. Moving into development sprint 3 next week.',
      created_by: '11111111-1111-1111-1111-000000000005',
    },
    {
      id: 'dddddddd-0001-0002-0003-000000000002',
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      content:
        'Frontend build kicked off. React component library scaffolded, design tokens imported from Figma. On track for March delivery.',
      created_by: '11111111-1111-1111-1111-000000000006',
    },
    {
      id: 'dddddddd-0001-0002-0003-000000000003',
      project_id: 'ffffffff-0001-0002-0003-000000000003',
      content:
        'Auth and secure messaging module shipped and passing all tests. Biometric login working on both iOS and Android.',
      created_by: '11111111-1111-1111-1111-000000000006',
    },
    {
      id: 'dddddddd-0001-0002-0003-000000000004',
      project_id: 'ffffffff-0001-0002-0003-000000000003',
      content:
        'Appointment booking wireframes reviewed with Vanta Health product team. Two rounds of feedback incorporated — moving to high-fidelity.',
      created_by: '11111111-1111-1111-1111-000000000005',
    },
    {
      id: 'dddddddd-0001-0002-0003-000000000005',
      project_id: 'ffffffff-0001-0002-0003-000000000004',
      content:
        'Three logo concepts presented to Vanta Health. Client selected the wordmark variant for refinement. Brand guidelines doc in progress.',
      created_by: '11111111-1111-1111-1111-000000000005',
    },
    {
      id: 'dddddddd-0001-0002-0003-000000000006',
      project_id: 'ffffffff-0001-0002-0003-000000000002',
      content:
        'Q2 campaign brief finalised. LinkedIn ad creative and email nurture sequence templates are in design review.',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
  ]);

  // Project Issues (for account pages roadblocks)
  console.log('   Loading project issues...');
  await supabase.from('project_issues').upsert([
    {
      id: 'eeeeeeee-0001-0002-0003-000000000001',
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      content:
        'Meridian legal team has not approved the data handling clause in the portal SLA. Blocking final sign-off on the document vault feature.',
      status: 'open',
      created_by: '11111111-1111-1111-1111-000000000004',
    },
    {
      id: 'eeeeeeee-0001-0002-0003-000000000002',
      project_id: 'ffffffff-0001-0002-0003-000000000003',
      content:
        "Push notification integration blocked — Vanta Health's Apple Developer account is pending review. Estimated 5–7 business days.",
      status: 'in_progress',
      created_by: '11111111-1111-1111-1111-000000000006',
    },
    {
      id: 'eeeeeeee-0001-0002-0003-000000000003',
      project_id: 'ffffffff-0001-0002-0003-000000000004',
      content:
        'Brand colour palette needs sign-off from Vanta Health CMO before we can finalise the guidelines document. Chased twice — awaiting response.',
      status: 'open',
      created_by: '11111111-1111-1111-1111-000000000005',
    },
  ]);

  // Add Alex Executive and Morgan Manager to project assignments (so they can see projects in dashboard)
  console.log('   Adding leadership to project assignments...');
  await supabase.from('project_assignments').upsert([
    // Alex Executive - assigned to all projects as executive oversight
    {
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      user_id: '11111111-1111-1111-1111-000000000002',
      role_in_project: 'Executive Oversight',
      assigned_by: '11111111-1111-1111-1111-000000000001',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000002',
      user_id: '11111111-1111-1111-1111-000000000002',
      role_in_project: 'Executive Oversight',
      assigned_by: '11111111-1111-1111-1111-000000000001',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000003',
      user_id: '11111111-1111-1111-1111-000000000002',
      role_in_project: 'Executive Oversight',
      assigned_by: '11111111-1111-1111-1111-000000000001',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000004',
      user_id: '11111111-1111-1111-1111-000000000002',
      role_in_project: 'Executive Oversight',
      assigned_by: '11111111-1111-1111-1111-000000000001',
    },
    // Morgan Manager - assigned to account projects as account manager
    {
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      user_id: '11111111-1111-1111-1111-000000000003',
      role_in_project: 'Account Manager',
      assigned_by: '11111111-1111-1111-1111-000000000001',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000002',
      user_id: '11111111-1111-1111-1111-000000000003',
      role_in_project: 'Account Manager',
      assigned_by: '11111111-1111-1111-1111-000000000001',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000003',
      user_id: '11111111-1111-1111-1111-000000000003',
      role_in_project: 'Account Manager',
      assigned_by: '11111111-1111-1111-1111-000000000001',
    },
    {
      project_id: 'ffffffff-0001-0002-0003-000000000004',
      user_id: '11111111-1111-1111-1111-000000000003',
      role_in_project: 'Account Manager',
      assigned_by: '11111111-1111-1111-1111-000000000001',
    },
    // Andy Admin - assigned to projects for time tracking testing
    {
      project_id: 'ffffffff-0001-0002-0003-000000000001',
      user_id: '11111111-1111-1111-1111-000000000009',
      role_in_project: 'Admin Support',
      assigned_by: '11111111-1111-1111-1111-000000000001',
    },
  ]);

  // Add availability for Alex, Morgan, and Andy
  console.log('   Adding availability for leadership...');
  for (let weekOffset = 0; weekOffset < 6; weekOffset++) {
    const weekStart = getWeekStartNWeeksAgo(weekOffset);
    // Alex Executive - 40 hours
    await supabase.from('user_availability').upsert({
      user_id: '11111111-1111-1111-1111-000000000002',
      week_start_date: weekStart,
      available_hours: 40,
    });
    // Morgan Manager - 40 hours
    await supabase.from('user_availability').upsert({
      user_id: '11111111-1111-1111-1111-000000000003',
      week_start_date: weekStart,
      available_hours: 40,
    });
    // Andy Admin - 40 hours
    await supabase.from('user_availability').upsert({
      user_id: '11111111-1111-1111-1111-000000000009',
      week_start_date: weekStart,
      available_hours: 40,
    });
  }

  // Add account members for Alex (so he can see all accounts)
  console.log('   Adding Alex to account memberships...');
  await supabase.from('account_members').upsert([
    {
      user_id: '11111111-1111-1111-1111-000000000002',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
    },
    {
      user_id: '11111111-1111-1111-1111-000000000002',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002',
    },
    {
      user_id: '11111111-1111-1111-1111-000000000002',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000003',
    },
    // Andy Admin - add to accounts too
    {
      user_id: '11111111-1111-1111-1111-000000000009',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
    },
    {
      user_id: '11111111-1111-1111-1111-000000000009',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002',
    },
    {
      user_id: '11111111-1111-1111-1111-000000000009',
      account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000003',
    },
  ]);

  console.log('   ✅ Seed data loaded');
}

// Run the script
createSeedUsers().catch((error) => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});
