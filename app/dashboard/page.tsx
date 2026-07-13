'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { Suspense } from 'react';
import { RoleGuard } from '@/components/role-guard';
import { Skeleton } from '@/components/ui/skeleton';
import dynamic from 'next/dynamic';

const ComponentSkeleton = () => (
  <div className="space-y-3">
    <Skeleton className="h-8 w-full" />
    <Skeleton className="h-32 w-full" />
  </div>
);

const UnifiedProjectsSection = dynamic(
  () => import('@/components/unified-projects-section').then((mod) => mod.UnifiedProjectsSection),
  { loading: () => <ComponentSkeleton />, ssr: false },
);
const MyTasksWidget = dynamic(() => import('@/components/dashboard/my-tasks-widget'), {
  loading: () => <ComponentSkeleton />,
  ssr: false,
});
const MyAccountsWidget = dynamic(() => import('@/components/dashboard/my-accounts-widget'), {
  loading: () => <ComponentSkeleton />,
  ssr: false,
});
const MyCollaboratorsWidget = dynamic(
  () => import('@/components/dashboard/my-collaborators-widget'),
  { loading: () => <ComponentSkeleton />, ssr: false },
);
const UpcomingDeadlinesWidget = dynamic(
  () => import('@/components/dashboard/upcoming-deadlines-widget'),
  { loading: () => <ComponentSkeleton />, ssr: false },
);
const RecentActivityWidget = dynamic(
  () => import('@/components/dashboard/recent-activity-widget'),
  { loading: () => <ComponentSkeleton />, ssr: false },
);

export default function DashboardPage() {
  const { userProfile } = useAuth();
  const firstName = (userProfile as any)?.name?.split(' ')[0] || 'there';

  return (
    <RoleGuard>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="page-title">Welcome back, {firstName}</h1>
          <p className="page-subtitle">Here&apos;s what&apos;s happening with your projects</p>
        </div>

        {/* Projects - full width */}
        <Suspense fallback={<ComponentSkeleton />}>
          <UnifiedProjectsSection userProfile={userProfile as any} />
        </Suspense>

        {/* Widget grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Suspense fallback={<ComponentSkeleton />}>
            <MyTasksWidget data={null} isLoading={false} />
          </Suspense>
          <Suspense fallback={<ComponentSkeleton />}>
            <MyAccountsWidget />
          </Suspense>
          <Suspense fallback={<ComponentSkeleton />}>
            <UpcomingDeadlinesWidget />
          </Suspense>
          <Suspense fallback={<ComponentSkeleton />}>
            <MyCollaboratorsWidget />
          </Suspense>
        </div>

        {/* Recent Activity - full width */}
        <Suspense fallback={<ComponentSkeleton />}>
          <RecentActivityWidget />
        </Suspense>
      </div>
    </RoleGuard>
  );
}
