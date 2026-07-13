'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, RefreshCw, Trash2, Users, Mail, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { InvitationDialog } from '@/components/onboarding/invitation-dialog';
import { InvitationList } from '@/components/onboarding/invitation-list';
import { RoleGuard } from '@/components/role-guard';
import { Permission } from '@/lib/permissions';
import { useAuth } from '@/lib/hooks/useAuth';
import { isUnassigned } from '@/lib/rbac';
import { apiFetch } from '@/lib/api-config';

interface Department {
  id: string;
  name: string;
}

interface Role {
  id: string;
  name: string;
  description: string | null;
  department_id: string;
  hierarchy_level: number;
  is_system_role: boolean;
  user_count: number;
  users: { id: string; name: string; email: string; image: string | null }[];
  departments?: { id: string; name: string } | null;
}

export default function RoleManagementPage() {
  const { userProfile, loading: authLoading } = useAuth();
  const router = useRouter();

  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [invitationRefreshKey, setInvitationRefreshKey] = useState(0);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createDeptId, setCreateDeptId] = useState('');
  const [creating, setCreating] = useState(false);

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!authLoading && userProfile && isUnassigned(userProfile)) {
      router.push('/welcome');
    }
  }, [authLoading, userProfile, router]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [rolesRes, deptsRes] = await Promise.all([
        apiFetch('/api/roles', { cache: 'no-store', credentials: 'include' }),
        apiFetch('/api/departments', { cache: 'no-store', credentials: 'include' }),
      ]);

      if (!rolesRes.ok) {
        const data = await rolesRes.json();
        if (rolesRes.status === 403) {
          router.push('/welcome');
          return;
        }
        throw new Error(data.error || 'Failed to load roles');
      }

      const rolesData = await rolesRes.json();
      const deptsData = deptsRes.ok ? await deptsRes.json() : [];

      setRoles(rolesData.roles || []);
      setDepartments(Array.isArray(deptsData) ? deptsData : deptsData.departments || []);
    } catch {
      toast.error('Failed to load data');
      setRoles([]);
      setDepartments([]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!authLoading && userProfile && !isUnassigned(userProfile)) {
      loadData();
    }
  }, [authLoading, userProfile, loadData]);

  const handleCreate = async () => {
    if (!createName.trim() || !createDeptId) {
      toast.error('Name and department are required');
      return;
    }
    setCreating(true);
    try {
      const res = await apiFetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          description: createDesc || null,
          department_id: createDeptId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create role');
      toast.success('Role created');
      setCreateOpen(false);
      setCreateName('');
      setCreateDesc('');
      setCreateDeptId('');
      loadData();
    } catch (e: any) {
      toast.error(e.message || 'Failed to create role');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!roleToDelete) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/roles/${roleToDelete.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete role');
      }
      toast.success('Role deleted');
      setDeleteOpen(false);
      setRoleToDelete(null);
      loadData();
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete role');
    } finally {
      setDeleting(false);
    }
  };

  if (authLoading || !userProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
      </div>
    );
  }

  if (isUnassigned(userProfile)) return null;

  return (
    <RoleGuard requirePermission={Permission.MANAGE_USER_ROLES}>
      <div className="container mx-auto space-y-6 px-4 py-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">User Management</h1>
            <p className="text-muted-foreground mt-1">Manage roles and team invitations</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={loadData} variant="outline" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => setInviteDialogOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Invite User
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Role
            </Button>
          </div>
        </div>

        <Tabs defaultValue="roles">
          <TabsList>
            <TabsTrigger value="roles" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Roles
            </TabsTrigger>
            <TabsTrigger value="invitations" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Invitations
            </TabsTrigger>
          </TabsList>

          {/* Roles Tab */}
          <TabsContent value="roles" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Roles</CardTitle>
                <CardDescription>All roles in the organization</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-muted-foreground py-8 text-center">Loading...</div>
                ) : roles.length === 0 ? (
                  <div className="text-muted-foreground py-8 text-center">
                    No roles found. Create your first role to get started.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {roles.map((role) => (
                      <div
                        key={role.id}
                        className="hover:bg-muted/30 flex items-center justify-between rounded-lg border p-4 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{role.name}</span>
                            {role.is_system_role && (
                              <Badge variant="secondary" className="text-xs">
                                System
                              </Badge>
                            )}
                            {role.departments?.name && (
                              <Badge variant="outline" className="text-xs">
                                {role.departments.name}
                              </Badge>
                            )}
                          </div>
                          {role.description && (
                            <p className="text-muted-foreground mt-0.5 truncate text-sm">
                              {role.description}
                            </p>
                          )}
                          <p className="text-muted-foreground mt-1 text-xs">
                            {role.user_count ?? role.users?.length ?? 0} user
                            {(role.user_count ?? role.users?.length ?? 0) !== 1 ? 's' : ''}
                          </p>
                        </div>
                        {!role.is_system_role && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-2"
                            onClick={() => {
                              setRoleToDelete(role);
                              setDeleteOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Invitations Tab */}
          <TabsContent value="invitations" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Team Invitations</CardTitle>
                    <CardDescription>
                      Invite new team members and manage pending invitations.
                    </CardDescription>
                  </div>
                  <Button size="sm" onClick={() => setInviteDialogOpen(true)}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Invite User
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <InvitationList key={invitationRefreshKey} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Create Role Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Role</DialogTitle>
              <DialogDescription>Add a new role to the organization.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="role-name">Name *</Label>
                <Input
                  id="role-name"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Senior Developer"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role-dept">Department *</Label>
                <select
                  id="role-dept"
                  value={createDeptId}
                  onChange={(e) => setCreateDeptId(e.target.value)}
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                >
                  <option value="">Select department...</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="role-desc">Description</Label>
                <Textarea
                  id="role-desc"
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  placeholder="Optional description"
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Role</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &quot;{roleToDelete?.name}&quot;? This cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Invite Dialog */}
        <InvitationDialog
          open={inviteDialogOpen}
          onOpenChange={setInviteDialogOpen}
          onInvited={() => setInvitationRefreshKey((k) => k + 1)}
        />
      </div>
    </RoleGuard>
  );
}
