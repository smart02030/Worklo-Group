'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Shield,
  CheckCircle,
  AlertCircle,
  Loader2,
  Lock,
  Database,
  Key,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';

interface SetupStatus {
  setupAvailable: boolean;
  hasSuperadmin: boolean;
  setupSecretConfigured: boolean;
  message: string;
}

// Wrapper component that uses useSearchParams
function SetupPageContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [setupSecret, setSetupSecret] = useState(searchParams.get('key') || '');
  const [message, setMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Check setup status
  useEffect(() => {
    async function checkStatus() {
      try {
        const response = await apiFetch('/api/setup');
        const data = await response.json();
        setSetupStatus(data);
      } catch {
        setMessage({ type: 'error', text: 'Failed to check setup status' });
      } finally {
        setLoading(false);
      }
    }

    checkStatus();
  }, []);

  const handleSetup = async () => {
    if (!setupSecret.trim()) {
      setMessage({ type: 'error', text: 'Please enter the setup secret key' });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const response = await apiFetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupSecret: setupSecret.trim() }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setMessage({
          type: 'success',
          text: data.message || 'You are now a superadmin! Redirecting...',
        });
        // Redirect to admin after a short delay
        setTimeout(() => {
          router.push('/admin');
        }, 2000);
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Setup failed. Please check your secret key.',
        });
      }
    } catch {
      setMessage({ type: 'error', text: 'Setup failed. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (loading || authLoading) {
    return (
      <div className="bg-card flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
          <p className="text-muted-foreground mt-2 text-sm">Checking setup status...</p>
        </div>
      </div>
    );
  }

  // Setup already completed
  if (setupStatus?.hasSuperadmin) {
    return (
      <div className="bg-card flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <CardTitle>Setup Complete</CardTitle>
            <CardDescription>
              A superadmin has already been configured for this installation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-center text-sm">
              If you need to access the admin panel, please contact your system administrator.
            </p>
            <div className="flex flex-col gap-2">
              <Button asChild>
                <Link href="/login">Go to Login</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/">Go to Home</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Setup secret not configured
  if (!setupStatus?.setupSecretConfigured) {
    return (
      <div className="bg-card flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100">
              <AlertCircle className="h-6 w-6 text-yellow-600" />
            </div>
            <CardTitle>Configuration Required</CardTitle>
            <CardDescription>The setup secret has not been configured.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-card rounded-lg p-4">
              <h3 className="text-foreground mb-2 font-medium">To complete setup:</h3>
              <ol className="text-muted-foreground list-inside list-decimal space-y-3 text-sm">
                <li>
                  Generate a secret key:
                  <code className="bg-muted mt-1 block rounded px-2 py-1 text-xs">
                    openssl rand -hex 32
                  </code>
                </li>
                <li>
                  Add it to your environment:
                  <ul className="mt-1 ml-4 list-inside list-disc space-y-1">
                    <li>
                      <strong>Local dev:</strong> Add{' '}
                      <code className="bg-muted rounded px-1">SETUP_SECRET=your-key</code> to{' '}
                      <code className="bg-muted rounded px-1">.env.local</code>
                    </li>
                    <li>
                      <strong>Vercel:</strong> Add{' '}
                      <code className="bg-muted rounded px-1">SETUP_SECRET</code> in Settings â†’
                      Environment Variables
                    </li>
                  </ul>
                </li>
                <li>Restart your application (or redeploy on Vercel)</li>
                <li>Return to this page and enter your secret key</li>
              </ol>
            </div>
            <p className="text-muted-foreground text-xs">
              See <code className="bg-muted rounded px-1">docs/setup/FIRST_TIME_SETUP.md</code> for
              the full guide.
            </p>
            <Button variant="outline" asChild className="w-full">
              <Link href="/">Go to Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User not logged in
  if (!user) {
    return (
      <div className="bg-card flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
              <UserPlus className="h-6 w-6 text-blue-600" />
            </div>
            <CardTitle>Create Your Account First</CardTitle>
            <CardDescription>
              You need to sign up for an account before becoming a superadmin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-card rounded-lg p-4">
              <h3 className="text-foreground mb-2 font-medium">Setup Steps:</h3>
              <ol className="text-muted-foreground list-inside list-decimal space-y-2 text-sm">
                <li>
                  Push database schema:{' '}
                  <code className="bg-muted rounded px-1 text-xs">supabase db push</code> (if not
                  done)
                </li>
                <li>Sign up for an account</li>
                <li>Return to this page with your setup secret</li>
              </ol>
            </div>
            <div className="flex flex-col gap-2">
              <Button asChild>
                <Link href={`/login?redirectTo=/setup${setupSecret ? `?key=${setupSecret}` : ''}`}>
                  Sign Up / Login
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Ready for setup
  return (
    <div className="bg-card flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
            <Shield className="h-6 w-6 text-blue-600" />
          </div>
          <CardTitle>First-Time Setup</CardTitle>
          <CardDescription>Configure your superadmin account to get started.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Prerequisites */}
          <div className="bg-card space-y-3 rounded-lg p-4">
            <h3 className="text-foreground font-medium">Prerequisites:</h3>
            <div className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4 text-green-600" />
              <span className="text-muted-foreground">Database schema deployed</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Key className="h-4 w-4 text-green-600" />
              <span className="text-muted-foreground">SETUP_SECRET configured</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <UserPlus className="h-4 w-4 text-green-600" />
              <span className="text-muted-foreground">Logged in as: {user.email}</span>
            </div>
          </div>

          {/* Setup Form */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="setupSecret">Setup Secret Key</Label>
              <Input
                id="setupSecret"
                type="password"
                placeholder="Enter your SETUP_SECRET"
                value={setupSecret}
                onChange={(e) => setSetupSecret(e.target.value)}
                disabled={submitting}
              />
              <p className="text-muted-foreground text-xs">
                This is the value of your SETUP_SECRET environment variable.
              </p>
            </div>

            <Button
              onClick={handleSetup}
              disabled={submitting || !setupSecret.trim()}
              className="w-full"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Setting up...
                </>
              ) : (
                <>
                  <Shield className="mr-2 h-4 w-4" />
                  Become Superadmin
                </>
              )}
            </Button>
          </div>

          {/* Message Display */}
          {message && (
            <div
              className={`flex items-start gap-2 rounded-lg p-4 ${
                message.type === 'error'
                  ? 'bg-destructive/10 text-destructive'
                  : message.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-primary/10 text-primary'
              }`}
            >
              {message.type === 'error' ? (
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              ) : message.type === 'success' ? (
                <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              ) : (
                <Lock className="mt-0.5 h-5 w-5 flex-shrink-0" />
              )}
              <p className="text-sm">{message.text}</p>
            </div>
          )}

          {/* Security Note */}
          <div className="border-t pt-4">
            <p className="text-muted-foreground text-center text-xs">
              This page is only available when no superadmin exists. After setup, it will be
              permanently disabled.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Loading fallback for Suspense
function SetupPageLoading() {
  return (
    <div className="bg-card flex min-h-screen items-center justify-center">
      <div className="text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
        <p className="text-muted-foreground mt-2 text-sm">Loading setup...</p>
      </div>
    </div>
  );
}

// Main export wrapped in Suspense for useSearchParams
export default function SetupPage() {
  return (
    <Suspense fallback={<SetupPageLoading />}>
      <SetupPageContent />
    </Suspense>
  );
}
