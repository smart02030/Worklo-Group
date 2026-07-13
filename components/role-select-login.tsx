'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getCurrentSession, signInWithEmail } from '@/lib/auth';
import {
  User,
  Briefcase,
  Code,
  Palette,
  Users,
  Building2,
  Loader2,
  Shield,
  UserCheck,
} from 'lucide-react';

type RoleLoginOption = {
  id: string;
  label: string;
  description: string;
  email: string;
  color: string;
  redirectTo?: string;
  icon: React.ComponentType<{ className?: string }>;
};

const ROLE_PASSWORD = 'Test1234!';

async function waitForSessionReady(opts?: { timeoutMs?: number; pollMs?: number }) {
  const timeoutMs = opts?.timeoutMs ?? 3000;
  const pollMs = opts?.pollMs ?? 100;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const session = await getCurrentSession().catch(() => null);
    if (session?.access_token) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }

  return false;
}

const ROLE_OPTIONS: RoleLoginOption[] = [
  {
    id: 'exec',
    label: 'Executive Director',
    description: 'Full analytics and org visibility',
    email: 'exec@test.local',
    color: 'bg-purple-500',
    icon: Building2,
  },
  {
    id: 'am',
    label: 'Account Manager',
    description: 'Account management views',
    email: 'manager@test.local',
    color: 'bg-blue-500',
    icon: Briefcase,
  },
  {
    id: 'pm',
    label: 'Project Manager',
    description: 'Projects, tasks, and capacity planning',
    email: 'pm@test.local',
    color: 'bg-green-500',
    icon: Users,
  },
  {
    id: 'admin',
    label: 'Admin',
    description: 'Workflows, roles, and newsletters',
    email: 'admin@test.local',
    color: 'bg-red-500',
    icon: Shield,
  },
  {
    id: 'designer',
    label: 'Senior Designer',
    description: 'Tasks and time tracking',
    email: 'designer@test.local',
    color: 'bg-pink-500',
    icon: Palette,
  },
  {
    id: 'developer',
    label: 'Senior Developer',
    description: 'Tasks and time tracking',
    email: 'dev@test.local',
    color: 'bg-orange-500',
    icon: Code,
  },
  {
    id: 'contributor',
    label: 'Contributor',
    description: 'Limited view (contributor access)',
    email: 'contributor@test.local',
    color: 'bg-teal-500',
    icon: UserCheck,
  },
  {
    id: 'client',
    label: 'Client',
    description: 'Client portal only (demo client account)',
    email: 'client@test.local',
    color: 'bg-gray-500',
    icon: User,
    redirectTo: '/client-portal',
  },
  {
    id: 'superadmin',
    label: 'SuperAdmin',
    description: 'Full system access',
    email: 'superadmin@test.local',
    color: 'bg-zinc-700',
    icon: Shield,
  },
];

export function RoleSelectLogin() {
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const searchParams = useSearchParams();

  const rawRedirect = searchParams.get('redirectTo') ?? '/welcome';
  const safeRedirect =
    rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/welcome';

  const handleRoleLogin = async (opt: RoleLoginOption) => {
    setIsLoading(opt.email);
    setError('');
    setMessage('');

    try {
      const { user } = await signInWithEmail(opt.email, ROLE_PASSWORD);
      if (user) {
        // Avoid a race where the next page loads before Supabase session is persisted.
        setMessage(`Signed in as ${opt.label}. Preparing session...`);
        await waitForSessionReady();
        setMessage(`Signed in as ${opt.label}. Redirecting...`);
        const target = opt.redirectTo ?? safeRedirect;
        window.location.href = target;
      }
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : 'Login failed';
      let errorMessage = rawMessage;

      if (rawMessage.includes('Supabase not configured')) {
        errorMessage = 'Database not connected. Check your Supabase credentials in .env.local.';
      } else if (rawMessage.includes('Invalid login credentials')) {
        errorMessage =
          'Seeded users not found. Run `npx tsx scripts/create-seed-users.ts` (or seed in Supabase) and try again.';
      } else if (
        rawMessage.includes('fetch') ||
        rawMessage.includes('network') ||
        rawMessage.includes('Failed to fetch')
      ) {
        errorMessage = 'Cannot reach the database. Check your Supabase URL and keys in .env.local.';
      }

      setError(errorMessage);
      setIsLoading(null);
    }
  };

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Choose a role to continue</CardTitle>
        <CardDescription className="text-base">
          This replaces email sign-in/sign-up for this demo. Your selection signs you in as a
          corresponding seeded user.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ROLE_OPTIONS.map((opt) => {
            const Icon = opt.icon || User;
            const isCurrentLoading = isLoading === opt.email;

            return (
              <Button
                key={opt.id}
                variant="outline"
                className={`hover:border-primary flex h-auto flex-col items-start p-4 text-left transition-all ${
                  isCurrentLoading ? 'opacity-70' : ''
                }`}
                onClick={() => handleRoleLogin(opt)}
                disabled={isLoading !== null}
              >
                <div className="flex w-full items-center gap-3">
                  <div className={`rounded-lg p-2 ${opt.color} text-white`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{opt.label}</div>
                    <div className="text-muted-foreground text-xs">{opt.description}</div>
                  </div>
                  {isCurrentLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                </div>
              </Button>
            );
          })}
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-center text-sm text-red-400">
            {error}
          </div>
        )}
        {message && (
          <div className="text-primary bg-primary/10 border-primary/20 rounded-lg border p-3 text-center text-sm">
            {message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
