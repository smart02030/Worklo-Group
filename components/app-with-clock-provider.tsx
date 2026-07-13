'use client';

import { AppLayout } from '@/components/app-layout';

interface AppWithClockProviderProps {
  children: React.ReactNode;
}

export function AppWithClockProvider({ children }: AppWithClockProviderProps) {
  return <AppLayout>{children}</AppLayout>;
}
