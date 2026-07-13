'use client';

// Account overview component - updated to fix module resolution
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ProjectDataTable,
  ProjectTableData,
  ProjectStatus,
  ProjectPriority,
} from '@/components/project-data-table';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  PlusIcon,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle,
  Users,
  BarChart3,
  Trash2,
  ExternalLink,
  Move,
  Edit,
} from 'lucide-react';
import {
  AccountWithProjects,
  AccountMetrics,
  UrgentItem,
  ProjectWithDetails,
  accountService,
} from '@/lib/account-service';
import { createClientSupabase } from '@/lib/supabase';

import TaskCreationDialog from '@/components/task-creation-dialog';
import { CapacityDashboard } from '@/components/capacity-dashboard';
import { MilestoneDialog } from '@/components/milestone-dialog';
import { format, formatDistance } from 'date-fns';
import { UserWithRoles, hasPermission } from '@/lib/rbac';
import { Permission } from '@/lib/permissions';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AccountEditDialog } from '@/components/account-edit-dialog';
import { apiFetch } from '@/lib/api-config';

interface AccountOverviewProps {
  account: AccountWithProjects;
  metrics: AccountMetrics;
  urgentItems: UrgentItem[];
  userProfile: UserWithRoles;
  hasFullAccess?: boolean; // If false, user has read-only access (project stakeholder only)
}

// Default kanban columns - will be overridden by account-specific config
const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'planned', name: 'Planned', color: '#6B7280', order: 1 },
  { id: 'in-progress', name: 'In Progress', color: '#3B82F6', order: 2 },
  { id: 'review', name: 'Review', color: '#F59E0B', order: 3 },
  { id: 'complete', name: 'Complete', color: '#10B981', order: 4 },
];

export function AccountOverview({
  account,
  metrics,
  urgentItems,
  userProfile,
  hasFullAccess = true,
}: AccountOverviewProps) {
  // Account overview component
  // NOTE: Kanban/Gantt for projects is deprecated (workflows replace it), only table view remains
  const router = useRouter();
  // Memoize account ID to avoid complex expressions in deps
  const accountId = useMemo(() => (account as any).id, [account]);

  const [projects, setProjects] = useState(account.projects);
  const [kanbanColumns, setKanbanColumns] = useState<KanbanColumn[]>(DEFAULT_KANBAN_COLUMNS);
  const [accountMembers, setAccountMembers] = useState<
    Array<{
      id: string;
      user_id: string;
      account_id: string;
      created_at: string;
      user: {
        id: string;
        name: string;
        email: string;
        image: string | null;
        roles: Array<{
          id: string;
          name: string;
          department: {
            id: string;
            name: string;
          } | null;
        }>;
      } | null;
    }>
  >([]);
  const [customColumnAssignments, setCustomColumnAssignments] = useState<Record<string, string>>(
    {},
  );
  const [milestones, setMilestones] = useState<any[]>([]);
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false);
  const [milestoneDialogInitialDate] = useState<Date | undefined>(undefined);
  const [projectDialogStartDate] = useState<Date | undefined>(undefined);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);

  // Move Project Dialog State
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [projectToMove, setProjectToMove] = useState<ProjectWithDetails | null>(null);

  // Active Issues State (stub — issues service removed)
  const [activeIssues] = useState<any[]>([]);
  const [loadingActiveIssues] = useState(false);

  // Finished Projects State
  const [finishedProjects, setFinishedProjects] = useState<ProjectWithDetails[]>([]);
  const [loadingFinishedProjects, setLoadingFinishedProjects] = useState(true);

  // Delete Confirmation Dialog State
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null);

  // Permission states
  // NOTE: Table view is just the project list (no separate permission needed)
  // Kanban/Gantt for projects is deprecated (workflows replace it)
  // View permissions are derived from project permissions
  const [canCreateProject, setCanCreateProject] = useState(false);
  const [canDeleteProject, setCanDeleteProject] = useState(false);
  const [canEditAccount, setCanEditAccount] = useState(false);

  // NOTE: Kanban/Gantt for projects is deprecated (workflows replace it), only table view remains

  // Load account members
  const loadAccountMembers = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/accounts/${accountId}/members`);

      // Get response text first to check if it's valid JSON
      const responseText = await response.text();
      let data: Record<string, unknown>;

      try {
        data = JSON.parse(responseText);
      } catch {
        // Set empty array if response is not valid JSON
        setAccountMembers([]);
        return;
      }

      if (!response.ok) {
        // Set empty array if error - don't crash the page
        setAccountMembers([]);
        return;
      }

      // Success - set the members
      setAccountMembers((data.members as typeof accountMembers) || []);
    } catch {
      // Set empty array on error - don't crash the page
      setAccountMembers([]);
    }
  }, [accountId]);

  useEffect(() => {
    loadAccountMembers();
  }, [loadAccountMembers]);

  // Separate state for remaining hours to avoid infinite loop
  // (fetching updates projects → re-triggers fetch → infinite loop)
  const [projectHoursData, setProjectHoursData] = useState<
    Record<string, { remaining: number | null; taskSum: number }>
  >({});

  // Fetch remaining hours for all projects - use projectIds as stable dependency
  const projectIds = useMemo(() => projects.map((p: any) => p.id).join(','), [projects]);

  useEffect(() => {
    if (!projectIds) return;

    const fetchRemainingHours = async () => {
      try {
        const supabase = createClientSupabase() as any;
        if (!supabase) return;

        const ids = projectIds.split(',');
        const { data: tasksData } = await supabase
          .from('tasks')
          .select('project_id, remaining_hours, estimated_hours')
          .in('project_id', ids);

        if (tasksData) {
          const hoursData: Record<string, { remaining: number | null; taskSum: number }> = {};
          tasksData.forEach((task: any) => {
            const pid = task.project_id as string;
            if (!hoursData[pid]) {
              hoursData[pid] = { remaining: 0, taskSum: 0 };
            }
            hoursData[pid].remaining =
              (hoursData[pid].remaining ?? 0) +
              ((task.remaining_hours as number) ?? (task.estimated_hours as number) ?? 0);
            hoursData[pid].taskSum += (task.estimated_hours as number) ?? 0;
          });
          setProjectHoursData(hoursData);
        }
      } catch {
        // Silently handle remaining hours fetch errors
      }
    };

    fetchRemainingHours();
  }, [projectIds]);

  // Check permissions
  // NOTE: Table view is just the project list (no separate permission needed)
  // Kanban/Gantt views for projects are deprecated (workflows replace them)
  const checkPermissions = useCallback(async () => {
    if (!userProfile) return;
    const manage = await hasPermission(userProfile, Permission.MANAGE_PROJECTS, { accountId });
    const editAccount = await hasPermission(userProfile, Permission.MANAGE_ACCOUNTS, { accountId });

    setCanCreateProject(manage);
    setCanDeleteProject(manage);
    setCanEditAccount(editAccount);
  }, [userProfile, accountId]);

  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  // Load milestones - stub (milestone service removed)
  useEffect(() => {
    setMilestones([]);
  }, []);

  // Active issues loading removed (issues service removed)

  // Load finished projects for this account
  const loadFinishedProjects = useCallback(async () => {
    setLoadingFinishedProjects(true);
    try {
      const supabase = createClientSupabase() as any;
      if (!supabase) return;

      const { data, error } = await supabase
        .from('projects')
        .select(
          `
            *,
            account:accounts(id, name)
          `,
        )
        .eq('account_id', accountId)
        .eq('status', 'complete')
        .order('updated_at', { ascending: false });

      if (error) {
        return;
      }

      // Map to ProjectWithDetails format
      const finished = (data || []).map(
        (p: any) =>
          ({
            ...p,
            departments: [],
            daysUntilDeadline: null,
          }) as unknown as ProjectWithDetails,
      );

      setFinishedProjects(finished);
    } catch {
      // Silently handle finished projects load errors
    } finally {
      setLoadingFinishedProjects(false);
    }
  }, [accountId]);

  useEffect(() => {
    loadFinishedProjects();
  }, [loadFinishedProjects]);

  // Issue status update removed (issues service removed)
  const handleUpdateIssueStatus = async (
    _issueId: string,
    _projectId: string,
    _newStatus: string,
  ) => {};

  // Load account-specific kanban configuration
  const loadKanbanConfig = useCallback(async () => {
    try {
      const config = await accountKanbanConfigService.getOrCreateAccountKanbanConfig(accountId);
      setKanbanColumns(config.columns.sort((a, b) => a.order - b.order));
    } catch {
      setKanbanColumns(DEFAULT_KANBAN_COLUMNS);
    }
  }, [accountId]);

  useEffect(() => {
    loadKanbanConfig();
  }, [loadKanbanConfig]);

  // Load custom column assignments from localStorage
  const loadCustomAssignments = useCallback(() => {
    try {
      const stored = localStorage.getItem(`kanban-custom-assignments-${accountId}`);
      if (stored) {
        const assignments = JSON.parse(stored);
        setCustomColumnAssignments(assignments);
      }
    } catch {
      // Silently handle localStorage errors
    }
  }, [accountId]);

  useEffect(() => {
    loadCustomAssignments();
  }, [loadCustomAssignments]);

  // Save custom column assignments to localStorage whenever they change
  useEffect(() => {
    if (Object.keys(customColumnAssignments).length > 0) {
      try {
        localStorage.setItem(
          `kanban-custom-assignments-${accountId}`,
          JSON.stringify(customColumnAssignments),
        );
      } catch {
        // Silently handle localStorage errors
      }
    }
  }, [customColumnAssignments, accountId]);

  const handleTaskCreated = (newProject: Record<string, unknown>, assignedUser?: any) => {
    if (newProject) {
      // Add the new project to local state immediately (optimistic update)
      // Don't use router.refresh() - it can cause CSS MIME type issues in Next.js dev mode
      const projectWithDetails = {
        ...newProject,
        departments: [],
        assigned_users: assignedUser
          ? [assignedUser as { id: string; name: string; image: string }]
          : [],
        status_info: { id: newProject.status || 'planning', name: 'Planning', color: '#6B7280' },
        workflow_step: null,
      } as unknown as ProjectWithDetails;
      setProjects((prev) => [projectWithDetails, ...prev]);
    }
  };

  const _getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return { backgroundColor: '#fee2e2', color: '#dc2626', borderColor: '#fca5a5' };
      case 'high':
        return { backgroundColor: '#fed7aa', color: '#ea580c', borderColor: '#fdba74' };
      case 'medium':
        return { backgroundColor: '#fef3c7', color: '#d97706', borderColor: '#fbbf24' };
      case 'low':
        return { backgroundColor: '#d1fae5', color: '#059669', borderColor: '#6ee7b7' };
      default:
        return { backgroundColor: '#f3f4f6', color: '#374151', borderColor: '#d1d5db' };
    }
  };

  // Transform projects to ProjectTableData format for the new table component
  const transformToTableData = (projectList: ProjectWithDetails[]): ProjectTableData[] => {
    return projectList.map((project) => ({
      id: project.id,
      name: project.name,
      workflowStep: project.workflow_step || undefined,
      priority: (project.priority || 'medium') as ProjectPriority,
      account: (account as any).name,
      accountId: (account as any).id,
      hours: {
        estimated: project.estimated_hours || undefined,
        actual: project.actual_hours || 0,
        remaining: project.estimated_hours
          ? Math.max(0, project.estimated_hours - (project.actual_hours || 0))
          : undefined,
      },
      deadline: project.end_date || undefined,
      assignedUsers: [], // This section doesn't have assigned users data per project
      status: (project.status || 'planning') as ProjectStatus,
    }));
  };

  const handleDeleteProject = (projectId: string) => {
    // Look in both active and finished projects
    const project =
      projects.find((p: any) => p.id === projectId) ||
      finishedProjects.find((p: any) => p.id === projectId);
    if (project) {
      setProjectToDelete({ id: project.id, name: project.name });
      setDeleteDialogOpen(true);
    }
  };

  const handleMoveProjectToStatus = async (projectId: string, newStatus: string) => {
    try {
      // Find the column that corresponds to this status
      const targetColumn = kanbanColumns.find(
        (col: any) =>
          accountKanbanConfigService.getStatusForKanbanColumn(col.id, kanbanColumns) === newStatus,
      );

      if (!targetColumn) {
        return;
      }

      // Check if this is a custom column (like "Approved") that should be visual-only
      const isCustomColumn = !['planned', 'in-progress', 'review', 'complete'].includes(
        targetColumn.id,
      );
      const isApprovedColumn =
        targetColumn.name.toLowerCase().includes('approved') ||
        targetColumn.name.toLowerCase().includes('approval');

      if (isCustomColumn && isApprovedColumn) {
        // For "Approved" columns, only update the custom column assignment (visual only)
        setCustomColumnAssignments((prev) => ({
          ...prev,
          [projectId]: targetColumn.id,
        }));
      } else {
        // For standard columns, update the database status

        const supabase = createClientSupabase() as any;
        if (!supabase) return;

        const { error } = await (supabase as any)
          .from('projects')
          .update({ status: newStatus })
          .eq('id', projectId);

        if (error) {
          return;
        }

        // Update the local state
        setProjects((prevProjects) =>
          prevProjects.map((project: any) =>
            project.id === projectId ? { ...project, status: newStatus } : project,
          ),
        );
      }

      // Update custom column assignment for all moves to maintain visual state
      setCustomColumnAssignments((prev) => ({
        ...prev,
        [projectId]: targetColumn.id,
      }));

      // Close the dialog
      setMoveDialogOpen(false);
      setProjectToMove(null);
    } catch {
      // Error moving project - silently handle
    }
  };

  // Filter out completed projects (they show in Finished Projects section)
  const activeProjects = projects.filter((project: any) => project.status !== 'complete');

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;

    try {
      const success = await accountService.deleteProject(projectToDelete.id);

      if (success) {
        // Remove from active projects
        setProjects((prev) => prev.filter((p: any) => p.id !== projectToDelete.id));
        // Also remove from finished projects
        setFinishedProjects((prev) => prev.filter((p: any) => p.id !== projectToDelete.id));
      } else {
        toast.error('Failed to delete project. Please try again.');
      }
    } catch {
      toast.error('Error deleting project. Please try again.');
    } finally {
      // Close dialog and reset state
      setDeleteDialogOpen(false);
      setProjectToDelete(null);
    }
  };

  // Convert projects to Gantt features

  // NOTE: Gantt chart handlers removed as Gantt view is deprecated

  // Handle project creation
  const handleProjectCreated = (newProject: any) => {
    if (newProject) {
      // Add the new project to local state immediately (optimistic update)
      const projectWithDetails = {
        ...newProject,
        departments: [],
        assigned_users: [],
        status_info: {
          id: (newProject.status as string) || 'planning',
          name: 'Planning',
          color: '#6B7280',
        },
        workflow_step: null,
      } as unknown as ProjectWithDetails;
      setProjects((prev) => [projectWithDetails, ...prev]);
    }
    setProjectDialogOpen(false);
  };

  // Milestone submit removed (milestone service removed)
  const handleMilestoneSubmit = async (_data: any) => {};

  // Helper function to map project status to kanban column
  const getKanbanColumn = (status: string) => {
    return accountKanbanConfigService.getKanbanColumnForStatus(status, kanbanColumns);
  };

  // Convert projects to Kanban format (kept for Move Project dialog compatibility)
  const _kanbanData = projects.map((project: any) => {
    // Check if this project has a custom column assignment
    const customColumn = customColumnAssignments[project.id];
    const columnId = customColumn || getKanbanColumn(project.status);

    return {
      id: project.id,
      name: project.name,
      column: columnId,
      description: project.description,
      startAt: project.start_date ? new Date(project.start_date) : new Date(),
      endAt: project.end_date ? new Date(project.end_date) : new Date(),
      owner: project.assigned_users?.[0] || null,
      priority: project.priority,
      tags: [],
    };
  });

  const getHealthScoreColor = (score: number) => {
    if (score >= 80) return 'text-[#4A5D3A]';
    if (score >= 60) return 'text-[#647878]';
    return 'text-[#3D464D]';
  };

  const getHealthScoreBg = (score: number) => {
    if (score >= 80) return 'bg-[#4A5D3A]/10';
    if (score >= 60) return 'bg-[#647878]/10';
    return 'bg-[#3D464D]/10';
  };

  return (
    <div className="bg-background min-h-screen">
      {/* Header - Responsive */}
      <div className="bg-background/95 supports-[backdrop-filter]:bg-background/60 border-b backdrop-blur">
        <div className="px-4 py-6 sm:px-6 sm:py-8">
          <div className="space-y-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <h1 className="text-foreground text-4xl font-bold">{(account as any).name}</h1>
                  <Badge
                    variant={(account as any).status === 'active' ? 'default' : 'secondary'}
                    className="w-fit text-xs whitespace-nowrap"
                    aria-label={`Account status: ${(account as any).status}`}
                  >
                    {(account as any).status}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-lg leading-relaxed">
                  {(account as any).description || 'No description provided'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {canEditAccount && (
                  <AccountEditDialog
                    account={account}
                    userProfile={userProfile}
                    onAccountUpdated={() => {
                      // Account will be refreshed via page reload in the dialog
                    }}
                  >
                    <Button variant="outline" size="sm" className="flex items-center gap-2">
                      <Edit className="h-4 w-4" />
                      <span className="hidden sm:inline">Edit Account</span>
                    </Button>
                  </AccountEditDialog>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6 sm:space-y-8">
        {/* 1. Projects Card */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-lg sm:text-xl">Projects</CardTitle>
                <p className="text-muted-foreground mt-1 text-sm">
                  Manage and track your account projects
                </p>
              </div>
              {canCreateProject && (
                <TaskCreationDialog
                  onTaskCreated={handleTaskCreated}
                  accountId={(account as any).id}
                  account={account as unknown as Record<string, unknown>}
                  userProfile={userProfile}
                  initialStartDate={projectDialogStartDate}
                >
                  <Button className="flex items-center gap-2" size="sm">
                    <PlusIcon className="h-4 w-4" />
                    <span className="hidden sm:inline">New Project</span>
                    <span className="sm:hidden">New</span>
                  </Button>
                </TaskCreationDialog>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Projects Table */}
            <ProjectDataTable
              projects={transformToTableData(activeProjects)}
              defaultVisibleColumns={[
                'name',
                'workflowStep',
                'priority',
                'hours',
                'deadline',
                'status',
              ]}
              onRowClick={(project) => router.push(`/projects/${project.id}`)}
            />
          </CardContent>
        </Card>

        {/* 2. Active Issues & Roadblocks Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[#647878]" />
              Active Issues & Roadblocks
            </CardTitle>
            <CardDescription>
              All open and in-progress issues across account projects
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingActiveIssues ? (
              <div className="py-8 text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-[#007EE5]"></div>
                <p className="text-muted-foreground mt-2 text-sm">Loading issues...</p>
              </div>
            ) : activeIssues.length === 0 ? (
              <div className="py-8 text-center">
                <CheckCircle className="mx-auto mb-4 h-12 w-12 text-[#4A5D3A]" />
                <p className="text-muted-foreground text-sm">
                  No active issues. Everything is running smoothly!
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeIssues.map((issue: any) => (
                  <div
                    key={issue.id}
                    className={`rounded-lg border p-4 ${
                      issue.status === 'in_progress'
                        ? 'border-[#647878]/30 bg-[#647878]/10'
                        : 'border-[#3D464D]/30 bg-[#3D464D]/10'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="space-y-2">
                        {/* Project Badge */}
                        {issue.project && (
                          <Badge variant="secondary" className="w-fit text-xs whitespace-nowrap">
                            {issue.project.name}
                          </Badge>
                        )}

                        {/* Issue Content */}
                        <p className="text-foreground text-sm break-words">{issue.content}</p>
                      </div>

                      {/* Issue Metadata and Status Selector */}
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div className="text-muted-foreground flex items-center gap-4 text-xs">
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            <span className="truncate">
                              {issue.user_profiles?.name || 'Unknown'}
                            </span>
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDistance(new Date(issue.created_at), new Date(), {
                              addSuffix: true,
                            })}
                          </span>
                        </div>

                        {/* Status Selector */}
                        <div className="flex-shrink-0">
                          <Select
                            value={issue.status}
                            onValueChange={(value) =>
                              handleUpdateIssueStatus(
                                issue.id,
                                issue.project_id,
                                value as 'open' | 'in_progress' | 'resolved',
                              )
                            }
                          >
                            <SelectTrigger className="h-8 w-[130px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">
                                <span className="flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full bg-[#3D464D]"></span>
                                  Open
                                </span>
                              </SelectItem>
                              <SelectItem value="in_progress">
                                <span className="flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full bg-[#647878]"></span>
                                  In Progress
                                </span>
                              </SelectItem>
                              <SelectItem value="resolved">
                                <span className="flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full bg-[#4A5D3A]"></span>
                                  Resolved
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3. Urgent Items Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Urgent Items
            </CardTitle>
            <CardDescription>Items requiring immediate attention</CardDescription>
          </CardHeader>
          <CardContent>
            {urgentItems.length === 0 ? (
              <div className="py-8 text-center">
                <CheckCircle className="mx-auto mb-4 h-12 w-12 text-[#4A5D3A]" />
                <p className="text-muted-foreground text-sm">No urgent items</p>
              </div>
            ) : (
              <div className="space-y-4">
                {urgentItems.map((item: any, index: any) => (
                  <div key={index} className="flex items-center rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-2 w-2 rounded-full ${item.priority === 'high' ? 'bg-[#3D464D]' : 'bg-[#647878]'}`}
                      />
                      <div>
                        <p className="text-sm font-medium">{item.title}</p>
                        <p className="text-muted-foreground text-xs">{item.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 4. Key Metrics Card - Health Scores */}
        <Card>
          <CardContent className="p-6">
            <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-6">
              {/* Health Score */}
              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  <div
                    className={`inline-flex h-12 w-12 items-center justify-center rounded-full ${getHealthScoreBg(metrics.healthScore)}`}
                  >
                    <span
                      className={`text-lg font-bold ${getHealthScoreColor(metrics.healthScore)}`}
                    >
                      {metrics.healthScore}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground text-sm font-medium">Health Score</p>
                  <p className="text-muted-foreground text-xs">Overall Health</p>
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  <BarChart3 className="h-8 w-8 text-[#007EE5]" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm font-medium">Active Projects</p>
                  <p className="text-foreground text-2xl font-bold">{metrics.activeProjects}</p>
                  <p className="text-muted-foreground text-xs">of {metrics.totalProjects} total</p>
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  <CheckCircle className="h-8 w-8 text-[#4A5D3A]" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm font-medium">Completed Projects</p>
                  <p className="text-2xl font-bold text-[#4A5D3A]">{metrics.completedProjects}</p>
                  <p className="text-muted-foreground text-xs">Successfully finished</p>
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  <Calendar className="h-8 w-8 text-[#647878]" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm font-medium">Upcoming Deadlines</p>
                  <p className="text-foreground text-2xl font-bold">{metrics.upcomingDeadlines}</p>
                  <p className="text-muted-foreground text-xs">Due within 7 days</p>
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  <AlertTriangle className="h-8 w-8 text-[#3D464D]" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm font-medium">Overdue Projects</p>
                  <p className="text-2xl font-bold text-[#3D464D]">{metrics.overdueProjects}</p>
                  <p className="text-muted-foreground text-xs">Require attention</p>
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  <Clock className="h-8 w-8 text-[#787878]" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm font-medium">Pending Approvals</p>
                  <p className="text-foreground text-2xl font-bold">{metrics.pendingApprovals}</p>
                  <p className="text-muted-foreground text-xs">Awaiting review</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 5. Account Capacity Trends */}
        <CapacityDashboard
          userProfile={userProfile}
          mode="account"
          accountId={(account as any).id}
        />

        {/* 6. Finished Projects Card */}
        {finishedProjects.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-[#4A5D3A]" />
                Finished Projects
              </CardTitle>
              <CardDescription>
                {finishedProjects.length} completed{' '}
                {finishedProjects.length === 1 ? 'project' : 'projects'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFinishedProjects ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#007EE5]" />
                </div>
              ) : (
                <div className="space-y-3">
                  {finishedProjects.map((project: any) => (
                    <div
                      key={project.id}
                      className="bg-card hover:bg-muted flex items-center justify-between rounded-lg border p-3 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/projects/${project.id}`}
                          className="text-foreground text-sm font-medium hover:text-[#007EE5] hover:underline"
                        >
                          {project.name}
                        </Link>
                        <div className="text-muted-foreground mt-1 flex items-center gap-3 text-xs">
                          {project.completed_at && (
                            <span className="flex items-center gap-1">
                              <CheckCircle className="h-3 w-3 text-[#4A5D3A]" />
                              Completed {format(new Date(project.completed_at), 'MMM d, yyyy')}
                            </span>
                          )}
                          {(project.actual_hours ?? 0) > 0 && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {project.actual_hours}h logged
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="ml-4 flex items-center gap-2">
                        <Badge className="bg-[#4A5D3A]/10 text-xs text-[#4A5D3A]">Complete</Badge>
                        <Link href={`/projects/${project.id}`}>
                          <Button variant="ghost" size="sm">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </Link>
                        {canDeleteProject && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteProject(project.id)}
                            className="hover:text-foreground hover:bg-muted h-8 w-8 p-0 text-[#3D464D]"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 7. Account Information Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Account Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Account Details Row */}
            <div className="grid grid-cols-2 gap-6 border-b pb-6 md:grid-cols-4">
              <div>
                <p className="text-muted-foreground text-sm">Primary Contact</p>
                <p className="text-sm font-medium">
                  {(account as any).primary_contact_name || 'Not specified'}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Email</p>
                <p className="text-sm font-medium">
                  {(account as any).primary_contact_email || 'No email'}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Created</p>
                <p className="text-sm font-medium">
                  {format(new Date((account as any).created_at), 'MMM dd, yyyy')}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Team Size</p>
                <p className="text-sm font-medium">
                  {accountMembers.length} member{accountMembers.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {/* Account Members Section */}
            {accountMembers.length > 0 && (
              <div className="pt-6">
                <p className="mb-4 text-sm font-medium">Team Members</p>
                <div className="flex flex-wrap gap-4">
                  {accountMembers.map(
                    (member: any) =>
                      member.user && (
                        <div key={member.id} className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={member.user.image || undefined} />
                            <AvatarFallback className="text-xs">
                              {member.user.name
                                ?.split(' ')
                                .map((n: string) => n[0])
                                .join('')
                                .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">{member.user.name}</p>
                            <p className="text-muted-foreground text-xs">
                              {member.user.roles && member.user.roles.length > 0
                                ? member.user.roles.map((r: any) => r.name).join(', ')
                                : 'No role assigned'}
                            </p>
                          </div>
                        </div>
                      ),
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Milestone Creation Dialog */}
      <MilestoneDialog
        open={milestoneDialogOpen}
        onOpenChange={setMilestoneDialogOpen}
        onCreateMilestone={handleMilestoneSubmit}
        initialDate={milestoneDialogInitialDate}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#3D464D]">
              <AlertTriangle className="h-5 w-5" />
              Delete Project?
            </DialogTitle>
          </DialogHeader>
          {projectToDelete && (
            <div className="space-y-3 pt-2">
              <p className="text-muted-foreground text-sm">
                You are about to delete{' '}
                <span className="text-foreground font-semibold">
                  &quot;{projectToDelete.name}&quot;
                </span>
                .
              </p>
              <div className="rounded-md border border-[#3D464D]/30 bg-[#3D464D]/10 p-3">
                <p className="text-sm text-[#3D464D]">
                  ⚠️ <strong>Warning:</strong> This action cannot be undone. All project data,
                  including updates, issues, and history will be permanently removed.
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteProject}
              className="bg-[#3D464D] hover:bg-[#282828]"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Project Creation Dialog - No trigger button, opened via Gantt chart clicks */}
      <TaskCreationDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        onTaskCreated={handleProjectCreated}
        accountId={(account as any).id}
        account={account as unknown as Record<string, unknown>}
        userProfile={userProfile}
        initialStartDate={projectDialogStartDate}
      >
        {null}
      </TaskCreationDialog>

      {/* Move Project Dialog */}
      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Move className="h-5 w-5" />
              Move Project
            </DialogTitle>
          </DialogHeader>
          {projectToMove && (
            <div className="space-y-4">
              <div>
                <p className="text-muted-foreground mb-2 text-sm">
                  Move <strong>{projectToMove.name}</strong> to a different status:
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {kanbanColumns.map((column: any) => {
                    const columnStatus = accountKanbanConfigService.getStatusForKanbanColumn(
                      column.id,
                      kanbanColumns,
                    );

                    // Check if this is the current column by looking at custom assignments or status mapping
                    const currentCustomColumn = customColumnAssignments[projectToMove.id];
                    const currentMappedColumn = getKanbanColumn(projectToMove.status);
                    const isCurrentColumn =
                      currentCustomColumn === column.id ||
                      (currentCustomColumn === undefined && currentMappedColumn === column.id);

                    return (
                      <Button
                        key={column.id}
                        variant="outline"
                        onClick={() => handleMoveProjectToStatus(projectToMove.id, columnStatus)}
                        className="h-auto justify-start p-3"
                        disabled={isCurrentColumn}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="h-2 w-2 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: column.color }}
                          />
                          <div className="text-left">
                            <div className="font-medium">{column.name}</div>
                            {isCurrentColumn && (
                              <div className="text-muted-foreground text-xs">Current status</div>
                            )}
                          </div>
                        </div>
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialogOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
