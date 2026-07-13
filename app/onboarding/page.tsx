'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SetupWizard } from '@/components/onboarding/setup-wizard';
import { apiFetch } from '@/lib/api-config';

export default function OnboardingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [isFirstRun, setIsFirstRun] = useState(false);

  useEffect(() => {
    apiFetch('/api/onboarding/check-first-run')
      .then((res) => res.json())
      .then((data) => {
        if (!data.firstRun) {
          router.replace('/login');
        } else {
          setIsFirstRun(true);
        }
        setChecking(false);
      })
      .catch(() => {
        setChecking(false);
      });
  }, [router]);

  if (checking) {
    return (
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
        <p className="text-muted-foreground mt-4">Checking system status...</p>
      </div>
    );
  }

  if (!isFirstRun) return null;

  return <SetupWizard />;
}
