'use client';

import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

export interface SidebarSectionProps {
  title?: string;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export function SidebarSection({ title, children, className }: SidebarSectionProps) {
  return (
    <div className={cn('py-2', className)}>
      {title && (
        <div className="px-3 pt-2 pb-1.5">
          <span className="text-[10px] font-semibold tracking-widest text-[var(--sidebar-section-header)] uppercase">
            {title}
          </span>
        </div>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
