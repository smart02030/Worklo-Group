'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { cn } from '@/lib/utils';
import { isSuperadmin, isUnassigned } from '@/lib/rbac';
import { Permission } from '@/lib/permissions';
import {
  computeUserPermissions,
  hasPermissionSync,
  hasAnyPermissionSync,
  ComputedPermissions,
} from '@/lib/permission-utils';
import {
  LayoutDashboard,
  Building2,
  Users,
  User,
  Settings,
  Shield,
  ChevronDown,
  ChevronRight,
  FolderOpen,
} from 'lucide-react';
import { SidebarItem } from './sidebar-item';
import { SidebarSection } from './sidebar-section';
import { SidebarUserProfile } from './sidebar-user-profile';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface NavigationItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: Permission;
  anyPermission?: Permission[];
  allowUnassigned?: boolean;
}

interface AdminMenuItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  anyPermission: Permission[];
}

const navigationItems: NavigationItem[] = [
  {
    name: 'Welcome',
    href: '/welcome',
    icon: User,
    allowUnassigned: true,
  },
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    anyPermission: [
      Permission.VIEW_PROJECTS,
      Permission.VIEW_ACCOUNTS,
      Permission.VIEW_DEPARTMENTS,
    ],
    allowUnassigned: false,
  },
  {
    name: 'Department',
    href: '/departments',
    icon: Building2,
    anyPermission: [Permission.VIEW_DEPARTMENTS, Permission.VIEW_ALL_DEPARTMENTS],
    allowUnassigned: false,
  },
  {
    name: 'Projects',
    href: '/projects',
    icon: FolderOpen,
    anyPermission: [Permission.VIEW_PROJECTS, Permission.VIEW_ALL_PROJECTS],
    allowUnassigned: false,
  },
  {
    name: 'Accounts',
    href: '/accounts',
    icon: Users,
    anyPermission: [Permission.VIEW_ACCOUNTS, Permission.VIEW_ALL_ACCOUNTS],
    allowUnassigned: false,
  },
];

const adminMenuItems: AdminMenuItem[] = [
  {
    name: 'Admin Dashboard',
    href: '/admin',
    icon: Settings,
    anyPermission: [
      Permission.MANAGE_USER_ROLES,
      Permission.MANAGE_USERS,
      Permission.MANAGE_DEPARTMENTS,
      Permission.MANAGE_ACCOUNTS,
    ],
  },
  {
    name: 'User Management',
    href: '/admin/roles',
    icon: Shield,
    anyPermission: [Permission.MANAGE_USER_ROLES, Permission.MANAGE_USERS],
  },
];

export function SidebarNavigation() {
  const [isMounted, setIsMounted] = useState(false);
  const [visibleItems, setVisibleItems] = useState<NavigationItem[]>(
    navigationItems.filter((item) => item.allowUnassigned === true),
  );
  const [permissionsChecked, setPermissionsChecked] = useState(false);
  const [visibleAdminItems, setVisibleAdminItems] = useState<AdminMenuItem[]>([]);
  const [deptExpanded, setDeptExpanded] = useState(false);
  const { userProfile, loading } = useAuth();
  const pathname = usePathname();

  // Handle hydration
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Get user departments
  const getUserDepartments = () => {
    if (!userProfile?.user_roles) return [];
    try {
      const deptMap = new Map<string, { id: string; name: string }>();

      userProfile.user_roles.forEach((ur: any) => {
        const dept = ur.roles?.departments;
        if (dept?.id && !deptMap.has(dept.id)) {
          deptMap.set(dept.id, {
            id: dept.id,
            name: dept.name,
          });
        }
      });

      return Array.from(deptMap.values());
    } catch {
      return [];
    }
  };

  // Check permissions for navigation items
  useEffect(() => {
    if (!isMounted || loading || !userProfile) {
      setVisibleItems(navigationItems.filter((item) => item.allowUnassigned === true));
      setPermissionsChecked(false);
      setVisibleAdminItems([]);
      return;
    }

    function filterItemsSync() {
      setPermissionsChecked(false);

      const isActuallyUnassigned = isUnassigned(userProfile);
      const userIsSuperadmin = isSuperadmin(userProfile);

      if (userIsSuperadmin) {
        setVisibleItems(navigationItems);
        setVisibleAdminItems(adminMenuItems);
        setPermissionsChecked(true);
        return;
      }

      if (isActuallyUnassigned) {
        const allowedItems = navigationItems.filter((item) => item.allowUnassigned === true);
        setVisibleItems(allowedItems);
        setVisibleAdminItems([]);
        setPermissionsChecked(true);
        return;
      }

      const computed: ComputedPermissions = computeUserPermissions(userProfile);

      const filtered: NavigationItem[] = [];
      for (const item of navigationItems) {
        if (!item.permission && (!item.anyPermission || item.anyPermission.length === 0)) {
          if (item.allowUnassigned === true) {
            filtered.push(item);
          }
          continue;
        }

        if (item.permission) {
          if (hasPermissionSync(computed, item.permission)) {
            filtered.push(item);
            continue;
          }
        }

        if (item.anyPermission && item.anyPermission.length > 0) {
          if (hasAnyPermissionSync(computed, item.anyPermission)) {
            filtered.push(item);
          }
        }
      }

      if (filtered.length === 0) {
        const welcomeItem = navigationItems.find((item) => item.allowUnassigned === true);
        if (welcomeItem) {
          filtered.push(welcomeItem);
        }
      }

      const filteredAdminItems: AdminMenuItem[] = [];
      for (const adminItem of adminMenuItems) {
        if (hasAnyPermissionSync(computed, adminItem.anyPermission)) {
          filteredAdminItems.push(adminItem);
        }
      }

      setVisibleItems(filtered);
      setVisibleAdminItems(filteredAdminItems);
      setPermissionsChecked(true);
    }

    try {
      filterItemsSync();
    } catch {
      setVisibleItems(navigationItems.filter((item) => item.allowUnassigned === true));
      setVisibleAdminItems([]);
      setPermissionsChecked(true);
    }
  }, [isMounted, loading, userProfile]);

  // Auto-expand department section if on department page
  useEffect(() => {
    if (pathname.startsWith('/departments')) {
      setDeptExpanded(true);
    }
  }, [pathname]);

  const userDepartments = getUserDepartments();
  const hasDepartmentItem = visibleItems.some((item) => item.name === 'Department');

  // Loading state
  if (!isMounted) {
    return (
      <aside className="flex h-screen w-60 flex-shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]">
        <div className="flex h-20 items-center border-b border-[var(--sidebar-border)] px-4">
          <div className="h-14 w-28 animate-pulse rounded bg-[var(--sidebar-active-bg)]" />
        </div>
        <div className="flex-1 space-y-1 p-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-[var(--sidebar-active-bg)]" />
          ))}
        </div>
        <div className="border-t border-[var(--sidebar-border)] p-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 animate-pulse rounded-full bg-[var(--sidebar-active-bg)]" />
            <div className="flex-1">
              <div className="mb-1 h-3 w-20 animate-pulse rounded bg-[var(--sidebar-active-bg)]" />
              <div className="h-2.5 w-14 animate-pulse rounded bg-[var(--sidebar-active-bg)]" />
            </div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Sidebar"
      className="flex h-screen w-60 flex-shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]"
    >
      {/* Logo */}
      <div className="relative flex h-20 items-center justify-center overflow-hidden border-b border-[var(--sidebar-border)] px-4">
        {/* Subtle brand glow (reduced) */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-60">
          <div
            className="h-24 w-24 rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgba(0,194,168,0.22) 0%, rgba(0,194,168,0.08) 55%, transparent 75%)',
              filter: 'blur(14px)',
            }}
          />
        </div>
        <Link
          href={
            userProfile?.user_roles && userProfile.user_roles.length > 0 ? '/dashboard' : '/welcome'
          }
          className="relative z-10 flex items-center"
          style={{ filter: 'drop-shadow(0 10px 30px rgba(0, 0, 0, 0.35))' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.gif" alt="Worklo" className="h-24 w-auto object-contain" />
        </Link>
      </div>

      {/* Navigation */}
      <nav
        className="flex-1 overflow-y-auto px-2 py-4"
        role="navigation"
        aria-label="Main navigation"
      >
        {/* Main Section */}
        <SidebarSection title="Main">
          {(!permissionsChecked
            ? navigationItems.filter((item) => item.allowUnassigned)
            : visibleItems
          ).map((item) => {
            // Special handling for Department with expandable sub-items
            if (item.name === 'Department' && hasDepartmentItem) {
              const isDeptActive = pathname.startsWith('/departments');

              return (
                <Collapsible key={item.name} open={deptExpanded} onOpenChange={setDeptExpanded}>
                  <CollapsibleTrigger asChild>
                    <button
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                        'relative',
                        isDeptActive
                          ? 'bg-[var(--sidebar-active-bg)] text-[var(--sidebar-text-active)]'
                          : 'text-[var(--sidebar-text-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-text)]',
                      )}
                      aria-expanded={deptExpanded}
                      aria-current={isDeptActive ? 'page' : undefined}
                    >
                      {isDeptActive && (
                        <div className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--sidebar-active-border)]" />
                      )}
                      <Building2
                        className={cn(
                          'h-4 w-4 flex-shrink-0',
                          isDeptActive ? 'text-[var(--sidebar-active-border)]' : '',
                        )}
                      />
                      <span className="flex-1 truncate text-left">Department</span>
                      {deptExpanded ? (
                        <ChevronDown className="h-4 w-4 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 flex-shrink-0" />
                      )}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-1 ml-4 space-y-0.5 border-l border-[var(--sidebar-border)] pl-3">
                      <Link
                        href="/departments"
                        aria-current={pathname === '/departments' ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] transition-colors',
                          pathname === '/departments'
                            ? 'font-medium text-[var(--sidebar-text-active)]'
                            : 'text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)]',
                        )}
                      >
                        All Departments
                      </Link>
                      {userDepartments.map((dept) => (
                        <Link
                          key={dept.id}
                          href={`/departments/${dept.id}`}
                          aria-current={pathname === `/departments/${dept.id}` ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] transition-colors',
                            pathname === `/departments/${dept.id}`
                              ? 'font-medium text-[var(--sidebar-text-active)]'
                              : 'text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)]',
                          )}
                        >
                          {dept.name}
                        </Link>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            }

            // Skip Welcome item in main section if user has roles
            if (
              item.name === 'Welcome' &&
              userProfile?.user_roles &&
              userProfile.user_roles.length > 0
            ) {
              return null;
            }

            return (
              <SidebarItem
                key={item.name}
                href={item.href}
                label={item.name}
                icon={item.icon as any}
              />
            );
          })}
        </SidebarSection>

        {/* Admin Section - only show if user has admin permissions */}
        {visibleAdminItems.length > 0 && (
          <SidebarSection title="Administration" className="mt-4">
            {visibleAdminItems.map((item) => (
              <SidebarItem
                key={item.href}
                href={item.href}
                label={item.name}
                icon={item.icon as any}
                exactMatch={item.href === '/admin'}
              />
            ))}
          </SidebarSection>
        )}
      </nav>

      {/* User Profile */}
      <SidebarUserProfile userProfile={userProfile as any} isLoading={loading} />
    </aside>
  );
}
