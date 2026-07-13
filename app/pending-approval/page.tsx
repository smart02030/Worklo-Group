'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { userApprovalService } from '@/lib/user-approval-service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Clock,
  Mail,
  LogOut,
  CheckCircle,
  AlertTriangle,
  Loader2,
  User,
  Calendar,
} from 'lucide-react';
import { logger, userAction } from '@/lib/debug-logger';

export default function PendingApprovalPage() {
  const { user, userProfile, loading, signOut } = useAuth();
  const router = useRouter();

  const [isApproved, setIsApproved] = useState<boolean | null>(null);
  const [checkingApproval, setCheckingApproval] = useState(true);
  const [approvalRequested, setApprovalRequested] = useState(false);

  const checkApprovalStatus = useCallback(async () => {
    if (!userProfile) return;

    try {
      setCheckingApproval(true);

      logger.debug('Checking user approval status', {
        action: 'checkApprovalStatus',
        userId: (userProfile as any).id,
      });

      const approved = await userApprovalService.isUserApproved((userProfile as any).id);
      setIsApproved(approved);

      if (approved) {
        logger.info('User is approved, redirecting to dashboard', {
          action: 'checkApprovalStatus',
          userId: (userProfile as any).id,
        });
        router.push('/dashboard');
      } else {
        logger.info('User is not approved, showing pending screen', {
          action: 'checkApprovalStatus',
          userId: (userProfile as any).id,
        });
      }
    } catch (error: unknown) {
      logger.error(
        'Error checking approval status',
        {
          action: 'checkApprovalStatus',
          userId: (userProfile as any)?.id,
        },
        error as Error,
      );
    } finally {
      setCheckingApproval(false);
    }
  }, [userProfile, router]);

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.push('/login');
      return;
    }

    if (!userProfile) {
      return;
    }

    checkApprovalStatus();
  }, [user, userProfile, loading, router, checkApprovalStatus]);

  const handleRequestApproval = async () => {
    if (!userProfile) return;

    try {
      setApprovalRequested(true);

      logger.info('User requesting approval', {
        action: 'handleRequestApproval',
        userId: (userProfile as any).id,
      });

      const success = await userApprovalService.requestApproval((userProfile as any).id);

      if (success) {
        userAction('approval_requested', (userProfile as any).id, {
          action: 'handleRequestApproval',
        });
        logger.info('Approval request submitted successfully', {
          action: 'handleRequestApproval',
          userId: (userProfile as any).id,
        });
      } else {
        logger.error('Failed to submit approval request', {
          action: 'handleRequestApproval',
          userId: (userProfile as any).id,
        });
      }
    } catch (error: unknown) {
      logger.error(
        'Error requesting approval',
        {
          action: 'handleRequestApproval',
          userId: (userProfile as any).id,
        },
        error as Error,
      );
    } finally {
      setApprovalRequested(false);
    }
  };

  const handleSignOut = async () => {
    try {
      userAction('signed_out', (userProfile as any)?.id || '', { action: 'handleSignOut' });
      await signOut();
      router.push('/login');
    } catch (error: unknown) {
      logger.error('Error signing out', { action: 'handleSignOut' }, error as Error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading || checkingApproval) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-primary mx-auto h-8 w-8 animate-spin rounded-full border-b-2"></div>
          <p className="text-muted-foreground mt-2 text-sm">Checking approval status...</p>
        </div>
      </div>
    );
  }

  if (isApproved === true) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <CheckCircle className="mx-auto mb-4 h-12 w-12 text-green-500" />
          <h1 className="mb-2 text-2xl font-bold text-green-600">Account Approved!</h1>
          <p className="text-muted-foreground mb-4">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-fit rounded-full bg-amber-100 p-3">
              <Clock className="h-8 w-8 text-amber-600" />
            </div>
            <CardTitle className="text-2xl text-amber-600">Account Pending Approval</CardTitle>
            <CardDescription className="text-lg">
              Your account is currently under review by our administrators.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* User Info */}
            {userProfile && (
              <div className="bg-muted/20 flex items-center gap-4 rounded-lg p-4">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={(userProfile as any).image || undefined} />
                  <AvatarFallback>
                    {(userProfile as any).name
                      ?.split(' ')
                      ?.map((n: any) => n[0])
                      ?.join('')
                      ?.toUpperCase() || '??'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <h3 className="font-semibold">{(userProfile as any).name}</h3>
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4" />
                    <span>{(userProfile as any).email}</span>
                  </div>
                  <div className="text-muted-foreground mt-1 flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4" />
                    <span>Joined: {formatDate((userProfile as any).created_at)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Status Message */}
            <div className="rounded-lg border border-amber-200 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                <div>
                  <h4 className="font-medium text-amber-800">What happens next?</h4>
                  <ul className="mt-2 space-y-1 text-sm text-amber-700">
                    <li>• An administrator will review your account</li>
                    <li>• You&apos;ll receive an email notification when approved</li>
                    <li>• Once approved, you can access all features</li>
                    <li>• This process typically takes 1-2 business days</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Contact Information */}
            <div className="bg-primary/10 rounded-lg border border-blue-200 p-4">
              <h4 className="text-primary mb-2 font-medium">Need Help?</h4>
              <p className="text-sm text-blue-700">
                If you have questions or need to expedite your approval, please contact:
              </p>
              <div className="mt-2 text-sm text-blue-700">
                <p>
                  <strong>Email:</strong> support@worklo.org
                </p>
                <p>
                  <strong>Phone:</strong> +1 (646) 755-3259
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                onClick={handleRequestApproval}
                disabled={approvalRequested}
                className="flex items-center gap-2"
              >
                {approvalRequested ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <User className="h-4 w-4" />
                )}
                {approvalRequested ? 'Requesting...' : 'Request Approval'}
              </Button>

              <Button onClick={handleSignOut} variant="outline" className="flex items-center gap-2">
                <LogOut className="h-4 w-4" />
                Sign Out
              </Button>
            </div>

            {/* Additional Info */}
            <div className="text-muted-foreground text-center text-sm">
              <p>You can check back later or contact support if you have any questions.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
