'use client';

// Account list component for displaying user-accessible accounts
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, Building2, Calendar, ArrowRight, Mail } from 'lucide-react';
import { Account } from '@/lib/account-service';
import { UserWithRoles, isSuperadmin, hasPermission } from '@/lib/rbac';
import { Permission } from '@/lib/permissions';
import { format } from 'date-fns';
import { AccountCreateDialog } from '@/components/account-create-dialog';

interface AccountListProps {
  accounts: Account[];
  userProfile: UserWithRoles;
  onAccountCreated?: () => void;
}

export function AccountList({ accounts, userProfile, onAccountCreated }: AccountListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [canCreateAccount, setCanCreateAccount] = useState(false);
  const [hasManageAccountsPermission, setHasManageAccountsPermission] = useState(false);
  // Accounts are pre-filtered by the server page component — trust the passed data
  const [visibleAccounts, setVisibleAccounts] = useState<Account[]>(accounts);

  // Check permissions for UI controls (create button, manage actions)
  useEffect(() => {
    if (!userProfile) return;

    async function checkPermissions() {
      const canManage = await hasPermission(userProfile, Permission.MANAGE_ACCOUNTS);
      setCanCreateAccount(canManage);
      setHasManageAccountsPermission(canManage);
    }

    void checkPermissions();
  }, [userProfile]);

  // Update visible accounts when props change
  useEffect(() => {
    setVisibleAccounts(accounts);
  }, [accounts]);

  const filteredAccounts = visibleAccounts.filter(
    (account: any) =>
      account.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      account.primary_contact_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      account.description?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-emerald-400';
      case 'inactive':
        return 'bg-muted text-foreground';
      case 'suspended':
        return 'bg-red-100 text-destructive';
      default:
        return 'bg-muted text-foreground';
    }
  };

  if (visibleAccounts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Users className="h-5 w-5" />
            <span>No Accounts Found</span>
          </CardTitle>
          <CardDescription>
            {isSuperadmin(userProfile)
              ? 'Get started by creating your first client account'
              : hasManageAccountsPermission
                ? 'No accounts have been created yet. Contact a superadmin to create accounts.'
                : "You don't have access to any accounts yet. Contact your administrator to be assigned to an account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="py-12 text-center">
            <Building2 className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
            <h3 className="text-foreground mb-2 text-lg font-medium">
              {isSuperadmin(userProfile)
                ? 'No accounts yet'
                : hasManageAccountsPermission
                  ? 'No accounts available'
                  : 'No account access'}
            </h3>
            <p className="text-muted-foreground mb-6">
              {isSuperadmin(userProfile)
                ? 'Create your first client account to start managing projects and relationships.'
                : hasManageAccountsPermission
                  ? 'No accounts have been created yet. Contact a superadmin to create accounts.'
                  : 'You need to be assigned to an account to view and manage projects. Please contact your administrator.'}
            </p>
            {canCreateAccount && (
              <AccountCreateDialog userProfile={userProfile} onAccountCreated={onAccountCreated} />
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search and Filters - Responsive */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="max-w-md flex-1">
          <div className="relative">
            <input
              type="text"
              placeholder="Search accounts..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
              }}
              className="border-input focus:ring-ring bg-background text-foreground w-full rounded-md border py-2 pr-4 pl-10 focus:border-transparent focus:ring-2"
            />
            <Users className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
          </div>
        </div>
        {canCreateAccount && (
          <div className="w-full sm:w-auto">
            <AccountCreateDialog userProfile={userProfile} onAccountCreated={onAccountCreated} />
          </div>
        )}
      </div>

      {/* Accounts Grid - Responsive */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        {filteredAccounts.map((account: any) => (
          <Card key={account.id} className="h-full transition-shadow hover:shadow-lg">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-foreground truncate text-lg font-bold">
                    {account.name}
                  </CardTitle>
                  <CardDescription className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                    {account.description || 'No description provided'}
                  </CardDescription>
                </div>
                <Badge
                  className={`${getStatusColor(account.status)} shrink-0 text-xs whitespace-nowrap`}
                >
                  {account.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Contact Information */}
              {account.primary_contact_name && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Users className="text-muted-foreground h-4 w-4" />
                    <span className="text-muted-foreground text-sm font-medium">
                      Primary Contact
                    </span>
                  </div>
                  <div className="ml-6 space-y-1">
                    <p className="text-foreground text-sm font-medium">
                      {account.primary_contact_name}
                    </p>
                    {account.primary_contact_email && (
                      <div className="flex items-center gap-1">
                        <Mail className="text-muted-foreground h-3 w-3" />
                        <span className="text-muted-foreground text-xs break-all">
                          {account.primary_contact_email}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Created Date */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Calendar className="text-muted-foreground h-4 w-4" />
                  <span className="text-muted-foreground text-sm font-medium">Created</span>
                </div>
                <div className="ml-6">
                  <p className="text-muted-foreground text-xs">
                    {format(new Date(account.created_at), 'MMM dd, yyyy')}
                  </p>
                </div>
              </div>

              {/* Action Button */}
              <div className="border-t pt-4">
                <Link href={`/accounts/${account.id}`}>
                  <Button variant="outline" className="w-full">
                    View Details
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* No Results */}
      {filteredAccounts.length === 0 && searchTerm && (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
            <h3 className="text-foreground mb-2 text-lg font-medium">No accounts found</h3>
            <p className="text-muted-foreground mb-4">
              No accounts match your search for &quot;{searchTerm}&quot;
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setSearchTerm('');
              }}
            >
              Clear Search
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
