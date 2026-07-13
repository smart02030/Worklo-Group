'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronUp, LogOut, User } from 'lucide-react';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  user_roles?: Array<{
    roles: {
      name: string;
      departments?: {
        name: string;
      } | null;
    };
  }>;
}

export interface SidebarUserProfileProps {
  userProfile: UserProfile | null;
  isLoading?: boolean;
}

export function SidebarUserProfile({ userProfile, isLoading = false }: SidebarUserProfileProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Get initials for avatar fallback
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Get primary role name
  const getPrimaryRole = () => {
    if (!userProfile?.user_roles?.length) return 'No Role';
    const role = userProfile.user_roles[0]?.roles;
    return role?.name || 'No Role';
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      router.push('/login');
      router.refresh();
    } catch (_error) {
      // Sign-out errors are non-critical - user is redirected to login regardless
    } finally {
      setIsSigningOut(false);
    }
  };

  if (isLoading) {
    return (
      <div className="border-t border-[var(--sidebar-border)] p-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 animate-pulse rounded-full bg-[var(--sidebar-active-bg)]" />
          <div className="min-w-0 flex-1">
            <div className="mb-1 h-3 w-20 animate-pulse rounded bg-[var(--sidebar-active-bg)]" />
            <div className="h-2.5 w-14 animate-pulse rounded bg-[var(--sidebar-active-bg)]" />
          </div>
        </div>
      </div>
    );
  }

  if (!userProfile) {
    return null;
  }

  return (
    <div className="border-t border-[var(--sidebar-border)]">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'flex w-full items-center gap-3 p-3',
              'transition-colors duration-150 hover:bg-[var(--sidebar-hover-bg)]',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--sidebar-active-border)] focus-visible:ring-inset',
            )}
          >
            <Avatar className="h-8 w-8 flex-shrink-0 ring-1 ring-white/10">
              <AvatarImage src={userProfile.image || undefined} alt={userProfile.name} />
              <AvatarFallback className="bg-primary/15 text-primary text-[11px] font-bold">
                {getInitials(userProfile.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-[13px] font-semibold text-[var(--sidebar-text-active)]">
                {userProfile.name}
              </p>
              <p className="truncate text-[11px] text-[var(--sidebar-text-muted)]">
                {getPrimaryRole()}
              </p>
            </div>
            <ChevronUp className="h-3.5 w-3.5 flex-shrink-0 text-[var(--sidebar-text-muted)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          className="mb-1 w-56 border-[var(--border)] bg-[var(--popover)]"
          sideOffset={4}
        >
          <div className="border-b border-[var(--border)] px-2 py-1.5">
            <p className="text-foreground truncate text-[13px] font-semibold">{userProfile.name}</p>
            <p className="text-muted-foreground truncate text-[11px]">{userProfile.email}</p>
          </div>
          <DropdownMenuItem asChild>
            <Link href="/profile" className="flex cursor-pointer items-center gap-2">
              <User className="h-4 w-4" />
              <span>Profile</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[var(--border)]" />
          <DropdownMenuItem
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="text-destructive focus:text-destructive cursor-pointer"
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span>{isSigningOut ? 'Signing out...' : 'Sign out'}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
