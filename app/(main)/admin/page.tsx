'use client';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Shield, Crown, Loader2, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { isSuperadmin } from '@/lib/rbac';
import { Permission } from '@/lib/permissions';
import { useMemo, useState } from 'react';
import { InvitationDialog } from '@/components/onboarding/invitation-dialog';

export default function AdminHubPage() {
  const { userProfile, loading } = useAuth();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  const userPermissions = useMemo(() => {
    if (!userProfile?.user_roles) return new Set<string>();
    const perms = new Set<string>();
    for (const ur of userProfile.user_roles) {
      const rolePerms = ur.roles?.permissions as Record<string, boolean> | undefined;
      if (rolePerms) {
        Object.entries(rolePerms).forEach(([perm, enabled]) => {
          if (enabled) perms.add(perm);
        });
      }
    }
    return perms;
  }, [userProfile]);

  const hasPermission = (perm: Permission) => userPermissions.has(perm);
  const isSuperadminUser = userProfile ? isSuperadmin(userProfile) : false;

  const features = [
    {
      title: 'User Management',
      description: 'Manage roles, permissions, and user assignments across departments.',
      icon: Shield,
      href: '/admin/roles',
      color: 'text-red-600 bg-destructive/10',
      show: isSuperadminUser || hasPermission(Permission.MANAGE_USER_ROLES),
    },
    {
      title: 'Superadmin Setup',
      description: 'Configure superadmin access and platform-wide settings.',
      icon: Crown,
      href: '/admin/superadmin-setup',
      color: 'text-amber-600 bg-amber-500/10',
      show: isSuperadminUser,
    },
  ];

  const visibleFeatures = features.filter((f) => f.show);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-8 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Administration</h1>
          <p className="text-muted-foreground mt-2 text-lg">Manage platform settings and users</p>
        </div>
        {(isSuperadminUser || hasPermission(Permission.MANAGE_USER_ROLES)) && (
          <Button onClick={() => setInviteDialogOpen(true)} className="w-full sm:w-auto">
            <UserPlus className="mr-2 h-4 w-4" />
            Invite User
          </Button>
        )}
      </div>

      <InvitationDialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen} />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {visibleFeatures.map((feature) => {
          const Icon = feature.icon;
          return (
            <Card key={feature.title} className="transition-shadow hover:shadow-lg">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className={`rounded-lg p-3 ${feature.color}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <Link href={feature.href}>
                    <Button variant="ghost" size="sm">
                      Open <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
                <CardTitle className="mt-4">{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
