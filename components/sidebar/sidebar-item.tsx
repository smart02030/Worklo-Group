'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

export interface SidebarItemProps {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number | string;
  disabled?: boolean;
  exactMatch?: boolean;
}

export function SidebarItem({
  href,
  label,
  icon: Icon,
  badge,
  disabled = false,
  exactMatch = false,
}: SidebarItemProps) {
  const pathname = usePathname();

  const isActive = exactMatch
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  if (disabled) {
    return (
      <div className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-[13px] text-[var(--sidebar-text-muted)] opacity-40">
        <Icon className="h-4 w-4 flex-shrink-0" />
        <span className="truncate">{label}</span>
      </div>
    );
  }

  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-all duration-150',
        'group relative',
        isActive
          ? 'bg-[var(--sidebar-active-bg)] text-[var(--sidebar-text-active)]'
          : 'text-[var(--sidebar-text-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--sidebar-text)]',
      )}
    >
      {/* Active indicator */}
      {isActive && (
        <div className="absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--sidebar-active-border)]" />
      )}

      <Icon
        className={cn(
          'h-4 w-4 flex-shrink-0 transition-colors',
          isActive
            ? 'text-[var(--sidebar-active-border)]'
            : 'group-hover:text-[var(--sidebar-text)]',
        )}
      />

      <span className="flex-1 truncate">{label}</span>

      {badge !== undefined && (
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
            isActive
              ? 'bg-primary text-primary-foreground'
              : 'bg-card/8 text-[var(--sidebar-text-muted)]',
          )}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
