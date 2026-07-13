'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { SidebarNavigation } from '@/components/sidebar';
import { TopHeader } from '@/components/top-header';
import { SidebarMobileDrawer } from '@/components/sidebar/sidebar-mobile-drawer';

interface AppLayoutProps {
  children: React.ReactNode;
}

// Pages that should NOT show the sidebar (auth pages, etc.)
const noSidebarPages = [
  '/login',
  '/signup',
  '/auth',
  '/reset-password',
  '/update-password',
  '/onboarding',
  '/invite',
];

export function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { userProfile, loading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Handle hydration
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Redirect client users to login since client portal is removed
  useEffect(() => {
    if (!loading && userProfile && (userProfile as any).is_client) {
      router.replace('/login');
    }
  }, [loading, userProfile, pathname, router]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Close mobile menu on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const handleMobileMenuToggle = useCallback(() => {
    setMobileMenuOpen((prev) => !prev);
  }, []);

  const handleMobileMenuClose = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  // Check if current page should show sidebar
  const shouldShowSidebar = !noSidebarPages.some((page) => pathname.startsWith(page));

  // For auth pages, render without sidebar
  if (!shouldShowSidebar) {
    return <div className="min-h-screen bg-[var(--background)]">{children}</div>;
  }

  // Show loading skeleton during hydration
  if (!isMounted) {
    return (
      <div className="flex h-screen bg-[var(--background)]">
        {/* Sidebar skeleton */}
        <aside className="hidden w-60 flex-shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] lg:flex">
          <div className="border-b border-[var(--sidebar-border)] p-4">
            <div className="h-10 w-32 animate-pulse rounded bg-[var(--sidebar-active-bg)]" />
          </div>
          <div className="flex-1 space-y-1 p-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-[var(--sidebar-active-bg)]" />
            ))}
          </div>
        </aside>

        {/* Content area skeleton */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-4">
            <div className="bg-card/5 h-6 w-40 animate-pulse rounded" />
            <div className="bg-card/5 h-8 w-8 animate-pulse rounded-full" />
          </header>
          <main role="main" className="flex-1 overflow-auto bg-[var(--background)] p-6">
            <div className="mx-auto max-w-[1400px] space-y-4">
              <div className="bg-card/5 h-8 w-64 animate-pulse rounded" />
              <div className="bg-card/3 h-40 animate-pulse rounded" />
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[var(--background)]">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <SidebarNavigation />
      </div>

      {/* Mobile Sidebar Drawer */}
      <SidebarMobileDrawer isOpen={mobileMenuOpen} onClose={handleMobileMenuClose} />

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <TopHeader onMobileMenuToggle={handleMobileMenuToggle} isMobileMenuOpen={mobileMenuOpen} />

        {/* Content */}
        <main role="main" className="flex-1 overflow-auto bg-[var(--background)]">
          <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
