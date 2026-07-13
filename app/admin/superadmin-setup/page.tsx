'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shield, UserPlus, UserMinus, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';
import { isSuperadmin } from '@/lib/rbac';
import { checkSuperadminRoleByEmail } from '@/lib/superadmin-utils';
import { apiFetch } from '@/lib/api-config';

interface Message {
  type: 'success' | 'error' | 'info';
  text: string;
}

export default function SuperadminSetupPage() {
  const { user, userProfile, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!loading && user && userProfile && !isSuperadmin(userProfile)) {
      router.push('/welcome');
    }
  }, [user, userProfile, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900"></div>
          <p className="text-muted-foreground mt-2 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  // If userProfile is still loading, show loading
  if (!userProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900"></div>
          <p className="text-muted-foreground mt-2 text-sm">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!user || !isSuperadmin(userProfile)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
          <h1 className="text-foreground mb-2 text-2xl font-bold">Access Denied</h1>
          <p className="text-muted-foreground">
            You don&apos;t have permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  const handleAssignSuperadmin = async () => {
    if (!email.trim()) {
      setMessage({ type: 'error', text: 'Please enter an email address' });
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const res = await apiFetch('/api/admin/superadmin', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), action: 'assign' }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ type: 'success', text: data.message });
        setEmail('');
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to assign superadmin role' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to assign superadmin role. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckStatus = async () => {
    if (!email.trim()) {
      setMessage({ type: 'error', text: 'Please enter an email address' });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const result = await checkSuperadminRoleByEmail(email.trim());
      if (result.success) {
        setMessage({ type: 'info', text: result.message });
      } else {
        setMessage({ type: 'error', text: result.message });
      }
    } catch (error: unknown) {
      setMessage({
        type: 'error',
        text: 'Failed to check superadmin status. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveSuperadmin = async () => {
    if (!email.trim()) {
      setMessage({ type: 'error', text: 'Please enter an email address' });
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const res = await apiFetch('/api/admin/superadmin', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), action: 'remove' }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ type: 'success', text: data.message });
        setEmail('');
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to remove superadmin role' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to remove superadmin role. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h1 className="text-foreground text-3xl font-bold">Superadmin Management</h1>
          <p className="text-muted-foreground mt-2">Manage superadmin roles and permissions</p>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => {
              router.back();
            }}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Admin
          </Button>
        </div>
      </div>

      {/* Assign Superadmin Role */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <UserPlus className="h-5 w-5" />
            <span>Assign Superadmin Role</span>
          </CardTitle>
          <CardDescription>
            Add superadmin privileges to an existing user by email address
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">User Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              disabled={isLoading}
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={handleAssignSuperadmin}
              disabled={isLoading || !email.trim()}
              className="flex-1"
            >
              {isLoading ? 'Processing...' : 'Assign Superadmin Role'}
            </Button>
            <Button
              onClick={handleCheckStatus}
              disabled={isLoading || !email.trim()}
              variant="outline"
              className="flex-1 sm:flex-none"
            >
              Check Status
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Remove Superadmin Role */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <UserMinus className="h-5 w-5" />
            <span>Remove Superadmin Role</span>
          </CardTitle>
          <CardDescription>Remove superadmin privileges from a user</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="remove-email">User Email</Label>
            <Input
              id="remove-email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <Button
            onClick={handleRemoveSuperadmin}
            disabled={isLoading || !email.trim()}
            variant="destructive"
            className="w-full"
          >
            {isLoading ? 'Processing...' : 'Remove Superadmin Role'}
          </Button>
        </CardContent>
      </Card>

      {/* Message Display */}
      {message && (
        <Card
          className={
            message.type === 'error'
              ? 'bg-destructive/10 border-red-200'
              : message.type === 'success'
                ? 'border-green-200 bg-emerald-500/10'
                : 'bg-primary/10 border-blue-200'
          }
        >
          <CardContent className="pt-6">
            <div className="flex items-start space-x-2">
              {message.type === 'error' ? (
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
              ) : message.type === 'success' ? (
                <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
              ) : (
                <Shield className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" />
              )}
              <p
                className={`text-sm font-medium break-words ${
                  message.type === 'error'
                    ? 'text-destructive'
                    : message.type === 'success'
                      ? 'text-emerald-400'
                      : 'text-primary'
                }`}
              >
                {message.text}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
