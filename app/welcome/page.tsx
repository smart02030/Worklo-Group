'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { isUnassigned, isSuperadmin } from '@/lib/rbac';
import {
  CheckCircle,
  Clock,
  Users,
  Building2,
  Mail,
  Phone,
  MapPin,
  ArrowRight,
  Shield,
} from 'lucide-react';

export default function WelcomePage() {
  const { user, userProfile, loading } = useAuth();
  const router = useRouter();

  const userIsUnassigned = userProfile ? isUnassigned(userProfile) : false;
  const isSuperadminUser = userProfile ? isSuperadmin(userProfile) : false;
  const hasRoles = userProfile ? !userIsUnassigned : false;

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  const isAccountCreated = !!user;
  const isEmailVerified = !!(user as any)?.email_confirmed_at;
  const isSetupComplete = isAccountCreated && isEmailVerified && hasRoles;
  const isActuallyUnassigned = userProfile ? isUnassigned(userProfile) : false;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-primary mx-auto h-8 w-8 animate-spin rounded-full border-b-2" />
          <p className="text-muted-foreground mt-3 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  /* ── Unassigned user view ── */
  if (!loading && userProfile && isActuallyUnassigned) {
    return (
      <div className="mx-auto mt-8 max-w-3xl space-y-8 px-4 sm:px-6 lg:px-8">
        <div className="space-y-2 text-center">
          <h1 className="page-title">
            {(userProfile as any)?.name
              ? `Hello, ${(userProfile as any).name}`
              : 'Welcome to Worklo'}
          </h1>
          <p className="page-subtitle">Your account is being set up</p>
        </div>

        <div className="border-border space-y-4 rounded-xl border bg-[var(--surface-2)] p-6">
          <h2 className="text-muted-foreground mb-4 text-sm font-semibold tracking-widest uppercase">
            Account Status
          </h2>
          {[
            { label: 'Account Created', done: isAccountCreated },
            { label: 'Email Verified', done: isEmailVerified },
            { label: 'Role Assignment', done: false },
          ].map((step) => (
            <div
              key={step.label}
              className="flex items-center justify-between border-b border-white/[0.06] py-2 last:border-0"
            >
              <span className="text-foreground text-sm font-medium">{step.label}</span>
              {step.done ? (
                <CheckCircle className="text-primary h-5 w-5" />
              ) : (
                <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-400">
                  Pending
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-6">
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-400" />
            <div>
              <h3 className="text-foreground mb-1 font-semibold">Role Assignment Pending</h3>
              <p className="text-muted-foreground text-sm">
                An administrator will assign you to the appropriate role and department.
              </p>
            </div>
          </div>
        </div>

        <div className="text-center">
          <Button
            onClick={() => router.push('/profile')}
            variant="outline"
            className="inline-flex items-center gap-2"
          >
            View Profile <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  /* ── Assigned user view ── */
  return (
    <div className="mt-8 space-y-8 px-4 sm:px-6 lg:px-8">
      <div className="space-y-2 text-center">
        <h1 className="page-title">
          {(userProfile as any)?.name ? `Hello, ${(userProfile as any).name}` : 'Welcome to Worklo'}
        </h1>
        <p className="page-subtitle">{isSuperadminUser ? 'Superadmin access' : 'Welcome back'}</p>
      </div>

      {!isSetupComplete && (
        <div className="border-border mx-auto max-w-2xl space-y-4 rounded-xl border bg-[var(--surface-2)] p-6">
          <div className="mb-4 flex items-center gap-2">
            <Shield className="text-primary h-5 w-5" />
            <h2 className="text-foreground font-semibold">Account Status</h2>
          </div>
          {[
            { label: 'Account Created', done: isAccountCreated },
            { label: 'Email Verified', done: isEmailVerified },
            {
              label: 'Role Assignment',
              done: hasRoles,
              extra: hasRoles ? (isSuperadminUser ? 'Superadmin' : 'Assigned') : null,
            },
          ].map((step) => (
            <div
              key={step.label}
              className="flex items-center justify-between border-b border-white/[0.06] py-2 last:border-0"
            >
              <span className="text-foreground text-sm font-medium">{step.label}</span>
              {step.done ? (
                <div className="flex items-center gap-2">
                  <CheckCircle className="text-primary h-5 w-5" />
                  {step.extra && (
                    <span className="text-primary text-xs font-medium">{step.extra}</span>
                  )}
                </div>
              ) : (
                <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-400">
                  Pending
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {!isSetupComplete && !isActuallyUnassigned && (
        <div className="mx-auto w-full max-w-4xl">
          <h2 className="text-foreground mb-6 text-center text-xl font-bold">What&apos;s Next?</h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {[
              {
                icon: <Users className="text-primary h-5 w-5" />,
                title: 'Role Assignment',
                body: 'An administrator will assign you to the appropriate department and role.',
              },
              {
                icon: <Building2 className="text-primary h-5 w-5" />,
                title: 'Department Access',
                body: "Once assigned, you'll have access to department-specific features and projects.",
              },
            ].map((card) => (
              <div
                key={card.title}
                className="border-border space-y-3 rounded-xl border bg-[var(--surface-2)] p-6"
              >
                <div className="flex items-center gap-2">
                  {card.icon}
                  <h3 className="text-foreground font-semibold">{card.title}</h3>
                </div>
                <p className="text-muted-foreground text-sm">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-6xl">
        <div className="border-border rounded-xl border bg-[var(--surface-2)] p-6">
          <h3 className="text-foreground mb-1 font-semibold">Need IT Support?</h3>
          <p className="text-muted-foreground mb-5 text-sm">
            Contact the Worklo team for assistance
          </p>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {[
              {
                icon: <Mail className="text-muted-foreground h-4 w-4" />,
                label: 'Email Support',
                value: 'support@worklo.org',
              },
              {
                icon: <Phone className="text-muted-foreground h-4 w-4" />,
                label: 'Phone Support',
                value: '+1 (646) 755-3259',
              },
              {
                icon: <MapPin className="text-muted-foreground h-4 w-4" />,
                label: 'Office',
                value: '888 Broadway, Floor 4, New York, NY 10003, US',
              },
            ].map((c) => (
              <div key={c.label} className="flex items-center gap-3">
                {c.icon}
                <div>
                  <p className="text-foreground text-sm font-medium">{c.label}</p>
                  <p className="text-muted-foreground text-sm">{c.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="pb-8 text-center">
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Button
            onClick={() => router.push('/dashboard')}
            className="inline-flex items-center gap-2"
          >
            Go to Dashboard <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => router.push('/profile')}
            variant="outline"
            className="inline-flex items-center gap-2"
          >
            View Profile <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
