'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  Users,
  FolderOpen,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  Settings,
  SortAsc,
  SortDesc,
  ExternalLink,
} from 'lucide-react';
import { Department, createClientSupabase } from '@/lib/supabase';

import { UserWithRoles } from '@/lib/rbac-types';
import { format } from 'date-fns';

interface DepartmentMetrics {
  id: string;
  name: string;
  description: string | null;
  activeProjects: number;
  teamSize: number;
  capacityUtilization: number;
  projectHealth: { healthy: number; atRisk: number; critical: number };
  workloadDistribution: any[];
  recentProjects: any[];
}
interface DepartmentProject {
  id: string;
  name: string;
  status: string;
  priority: string;
  end_date?: string | null;
  estimated_hours?: number | null;
  actual_hours?: number;
  assigned_users?: any[];
}

interface DepartmentOverviewProps {
  department: Department;
  metrics: DepartmentMetrics;
  projects: DepartmentProject[];
  canManageDepartments: boolean;
  userProfile: UserWithRoles;
}

export function DepartmentOverview({
  department,
  metrics,
  projects,
  canManageDepartments,
  userProfile,
}: DepartmentOverviewProps) {
  const [sortBy, setSortBy] = useState<'name' | 'priority' | 'deadline'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [workflowSteps, setWorkflowSteps] = useState<{ [key: string]: string | null }>({});

  // Projects with task data
  const [projectsWithTaskData, setProjectsWithTaskData] =
    useState<(DepartmentProject & { task_hours_sum?: number })[]>(projects);

  // Issues State (stub — issues service removed)
  const [activeIssues] = useState<any[]>([]);
  const [loadingActiveIssues] = useState(false);

  // Fetch task hours sum for projects
  useEffect(() => {
    const fetchTaskHours = async () => {
      if (!projects || projects.length === 0) return;

      const supabase = createClientSupabase();
      if (!supabase) return;

      const projectIds = projects.map((p: any) => p.id);
      const { data: tasksData } = await supabase
        .from('tasks')
        .select('project_id, estimated_hours')
        .in('project_id', projectIds);

      if (tasksData) {
        const projectTaskSum: Record<string, number> = {};
        tasksData.forEach((task: any) => {
          const projectId = task.project_id as string;
          if (!projectTaskSum[projectId]) {
            projectTaskSum[projectId] = 0;
          }
          projectTaskSum[projectId] += (task.estimated_hours as number) || 0;
        });

        setProjectsWithTaskData(
          projects.map((project: any) => ({
            ...project,
            task_hours_sum: projectTaskSum[project.id] || 0,
          })),
        );
      }
    };

    void fetchTaskHours();
  }, [projects]);

  // Active issues loading removed (issues service removed)

  // Fetch workflow steps for projects
  useEffect(() => {
    if (!projects || projects.length === 0) {
      setWorkflowSteps({});
      return;
    }

    async function fetchWorkflowSteps() {
      const supabase = createClientSupabase();
      if (!supabase) return;

      const projectIds = projects.map((p: any) => p.id);
      const { data: workflowData, error } = await supabase
        .from('workflow_instances')
        .select(
          `
          project_id,
          current_node_id,
          workflow_nodes!workflow_instances_current_node_id_fkey (
            label
          )
        `,
        )
        .in('project_id', projectIds)
        .eq('status', 'active');

      if (!error && workflowData) {
        const steps: { [key: string]: string | null } = {};
        workflowData.forEach((instance: any) => {
          const projectId = instance.project_id as string;
          const workflowNode = instance.workflow_nodes as
            | Record<string, unknown>
            | null
            | undefined;
          if (projectId && workflowNode?.label) {
            steps[projectId] = workflowNode.label as string;
          }
        });
        setWorkflowSteps(steps);
      }
    }

    void fetchWorkflowSteps();
  }, [projects]);

  // Split projects into active and finished
  const activeProjects = projectsWithTaskData.filter((p: any) => p.status !== 'complete');
  const finishedProjects = projectsWithTaskData.filter((p: any) => p.status === 'complete');

  // Sort and filter active projects only
  const filteredAndSortedProjects = activeProjects
    .filter((project: any) => {
      if (priorityFilter !== 'all' && project.priority !== priorityFilter) return false;
      return true;
    })
    .sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'priority':
          const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
          comparison = priorityOrder[b.priority] - priorityOrder[a.priority];
          break;
        case 'deadline':
          if (!a.endDate && !b.endDate) comparison = 0;
          else if (!a.endDate) comparison = 1;
          else if (!b.endDate) comparison = -1;
          else comparison = new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    })
    .map((project: any) => ({
      ...project,
      workflow_step: workflowSteps[project.id] ?? null,
    }));

  // Chart data for workload distribution
  const workloadChartData = metrics.workloadDistribution.map((member: any) => ({
    name: member.userName,
    workload: member.workloadPercentage,
    sentiment: member.workloadSentiment,
  }));

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-destructive border-red-200 hover:bg-red-200 hover:text-destructive';
      case 'high':
        return 'bg-orange-100 text-orange-400 border-orange-200 hover:bg-orange-200 hover:text-orange-400';
      case 'medium':
        return 'bg-yellow-100 text-amber-400 border-yellow-200 hover:bg-yellow-200 hover:text-amber-400';
      case 'low':
        return 'bg-green-100 text-emerald-400 border-green-200 hover:bg-green-200 hover:text-emerald-400';
      default:
        return 'bg-muted text-foreground border-white/10 hover:bg-muted hover:text-foreground';
    }
  };

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="space-y-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <h1 className="text-foreground text-4xl font-bold">{department.name}</h1>
            {department.description && (
              <p className="text-muted-foreground text-lg leading-relaxed">
                {department.description}
              </p>
            )}
          </div>
          {canManageDepartments && (
            <div className="flex gap-3">
              <Link href={`/departments/${department.id}/admin`}>
                <Button
                  variant="outline"
                  size="sm"
                  className="inline-flex h-10 items-center space-x-2 px-4"
                >
                  <Settings className="h-4 w-4" />
                  <span>Manage Department</span>
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Key Metrics Card */}
      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="flex items-center space-x-4">
              <div className="flex-shrink-0">
                <FolderOpen className="h-8 w-8 text-blue-600" />
              </div>
              <div>
                <p className="text-muted-foreground text-sm font-medium">Active Projects</p>
                <p className="text-foreground text-2xl font-bold">{metrics.activeProjects}</p>
                <p className="text-muted-foreground text-xs">
                  Projects assigned to this department
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex-shrink-0">
                <Users className="h-8 w-8 text-green-600" />
              </div>
              <div>
                <p className="text-muted-foreground text-sm font-medium">Team Size</p>
                <p className="text-foreground text-2xl font-bold">{metrics.teamSize}</p>
                <p className="text-muted-foreground text-xs">Users assigned to this department</p>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex-shrink-0">
                <TrendingUp className="h-8 w-8 text-purple-600" />
              </div>
              <div>
                <p className="text-muted-foreground text-sm font-medium">Capacity Utilization</p>
                <p className="text-foreground text-2xl font-bold">{metrics.capacityUtilization}%</p>
                <p className="text-muted-foreground text-xs">Current team workload</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Charts Section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Team Capacity Utilization Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Team Capacity Utilization
            </CardTitle>
            <CardDescription>Current capacity utilization across team members</CardDescription>
          </CardHeader>
          <CardContent>
            {workloadChartData.length === 0 ? (
              <div className="text-muted-foreground flex h-64 items-center justify-center">
                <div className="text-center">
                  <Users className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
                  <p>No team members assigned to this department</p>
                </div>
              </div>
            ) : (
              <div>
                <ResponsiveContainer width="100%" height={256}>
                  <BarChart
                    data={workloadChartData}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} fontSize={12} />
                    <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                    <Tooltip
                      formatter={(value: string | number) => {
                        return [`${value}%`, 'Utilization'];
                      }}
                      labelFormatter={(label) => `Team Member: ${label}`}
                    />
                    <Bar dataKey="workload" radius={[4, 4, 0, 0]}>
                      {workloadChartData.map((entry: any, index: any) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            entry.workload >= 90
                              ? '#EF4444'
                              : entry.workload >= 75
                                ? '#F59E0B'
                                : '#10B981'
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-4 flex items-center justify-center gap-4 text-xs">
              <div className="flex items-center gap-1">
                <div className="h-3 w-3 rounded bg-green-500" />
                <span>&lt;75% Healthy</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="h-3 w-3 rounded bg-yellow-500" />
                <span>75-90% Stretched</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="h-3 w-3 rounded bg-red-500" />
                <span>&gt;90% Overloaded</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Department Activity Overview */}
        <Card>
          <CardHeader>
            <CardTitle>Department Activity Overview</CardTitle>
            <CardDescription>Recent activity and project status distribution</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-primary/10 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {projects.filter((p: any) => p.status === 'planning').length}
                  </div>
                  <div className="text-primary text-sm">Planning</div>
                </div>
                <div className="rounded-lg bg-amber-500/10 p-4 text-center">
                  <div className="text-2xl font-bold text-yellow-600">
                    {projects.filter((p: any) => p.status === 'in_progress').length}
                  </div>
                  <div className="text-sm text-amber-400">In Progress</div>
                </div>
                <div className="rounded-lg bg-purple-500/10 p-4 text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {projects.filter((p: any) => p.status === 'review').length}
                  </div>
                  <div className="text-sm text-purple-400">In Review</div>
                </div>
                <div className="rounded-lg bg-emerald-500/10 p-4 text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {projects.filter((p: any) => p.status === 'complete').length}
                  </div>
                  <div className="text-sm text-emerald-400">Complete</div>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total Projects</span>
                  <span className="font-semibold">{projects.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Active Projects</span>
                  <span className="font-semibold">{metrics.activeProjects}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Team Members</span>
                  <span className="font-semibold">{metrics.teamSize}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Issues Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            Active Issues
          </CardTitle>
          <CardDescription>Issues requiring attention from department projects</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingActiveIssues ? (
            <div className="py-8 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-orange-600"></div>
              <p className="text-muted-foreground mt-2 text-sm">Loading issues...</p>
            </div>
          ) : activeIssues.length === 0 ? (
            <div className="py-8 text-center">
              <CheckCircle className="mx-auto mb-4 h-12 w-12 text-green-500" />
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
                      ? 'border-yellow-200 bg-amber-500/10'
                      : 'border-orange-200 bg-orange-500/10'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`${issue.status === 'in_progress' ? 'bg-yellow-100 text-amber-400' : 'bg-orange-100 text-orange-400'} text-xs whitespace-nowrap`}
                            aria-label={`Issue status: ${issue.status.replace('_', ' ')}`}
                          >
                            {issue.status.replace('_', ' ')}
                          </Badge>
                          {issue.project && (
                            <Badge variant="secondary" className="text-xs whitespace-nowrap">
                              {issue.project.name}
                            </Badge>
                          )}
                        </div>
                        <h4 className="text-foreground mb-1 font-medium">
                          Issue #{issue.id.slice(-6)}
                        </h4>
                        <p className="text-muted-foreground line-clamp-2 text-sm break-words">
                          {issue.content}
                        </p>
                      </div>
                      <div className="flex-shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          asChild
                          className="hidden whitespace-nowrap sm:inline-flex"
                        >
                          <Link href={`/projects/${issue.project_id}`}>View Project</Link>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          asChild
                          className="h-8 w-8 p-0 sm:hidden"
                        >
                          <Link href={`/projects/${issue.project_id}`}>
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-4 text-xs">
                      <span>Created {format(new Date(issue.created_at), 'MMM dd, yyyy')}</span>
                      {issue.user_profiles && (
                        <div className="flex items-center gap-1">
                          <Avatar className="h-4 w-4">
                            <AvatarImage src={issue.user_profiles.image || undefined} />
                            <AvatarFallback className="text-xs">
                              {issue.user_profiles.name
                                ?.split(' ')
                                .map((n: string) => n[0])
                                .join('')}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate">{issue.user_profiles.name}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Projects Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col space-y-4">
            <CardTitle>Active Projects</CardTitle>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Priority</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={sortBy}
                  onValueChange={(value: 'name' | 'priority' | 'deadline') => {
                    setSortBy(value);
                  }}
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="priority">Priority</SelectItem>
                    <SelectItem value="deadline">Deadline</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                  className="w-full sm:w-auto"
                >
                  {sortOrder === 'asc' ? (
                    <SortAsc className="h-4 w-4" />
                  ) : (
                    <SortDesc className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-muted-foreground px-4 py-3 text-left font-medium">Project</th>
                  <th className="text-muted-foreground px-4 py-3 text-left font-medium">
                    Workflow Step
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-left font-medium">
                    Priority
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-left font-medium">Account</th>
                  <th className="text-muted-foreground px-4 py-3 text-left font-medium">
                    Est Hours
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-left font-medium">
                    Deadline
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedProjects.map((project: any) => (
                  <tr key={project.id} className="hover:bg-card border-b">
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-foreground font-medium">{project.name}</p>
                        {project.description && (
                          <p className="text-muted-foreground line-clamp-2 text-sm">
                            {project.description}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {project.workflow_step ? (
                        <Badge className="text-primary border border-blue-300 bg-blue-100 text-xs whitespace-nowrap">
                          {project.workflow_step}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">No workflow</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={`${getPriorityColor(project.priority)} text-xs whitespace-nowrap`}
                        aria-label={`Priority: ${project.priority}`}
                      >
                        {project.priority}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-muted-foreground text-sm">{project.accountName}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4 text-blue-500" />
                        <span className="text-sm font-semibold text-blue-600">
                          {project.estimatedHours ? `${project.estimatedHours}h` : '-'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {project.endDate ? (
                        <div>
                          <p className="text-foreground text-sm">
                            {format(new Date(project.endDate), 'MMM dd, yyyy')}
                          </p>
                          {project.daysUntilDeadline !== null && (
                            <p
                              className={`text-xs ${
                                project.daysUntilDeadline < 0
                                  ? 'text-red-600'
                                  : project.daysUntilDeadline <= 7
                                    ? 'text-yellow-600'
                                    : 'text-muted-foreground'
                              }`}
                            >
                              {project.daysUntilDeadline < 0
                                ? `${Math.abs(project.daysUntilDeadline)} days overdue`
                                : `${project.daysUntilDeadline} days left`}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">No deadline</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="sm" asChild className="h-8 w-8 p-0">
                        <Link href={`/projects/${project.id}`}>
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Finished Projects Section */}
      {finishedProjects.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Finished Projects
            </CardTitle>
            <CardDescription>
              {finishedProjects.length} completed{' '}
              {finishedProjects.length === 1 ? 'project' : 'projects'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {finishedProjects.map((project: any) => (
                <div
                  key={project.id}
                  className="hover:bg-card flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/projects/${project.id}`}
                      className="text-foreground font-medium hover:text-blue-600"
                    >
                      {project.name}
                    </Link>
                    <div className="text-muted-foreground mt-1 flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1">
                        <CheckCircle className="h-3 w-3 text-green-500" />
                        Complete
                      </span>
                      {project.accountName && <span>{project.accountName}</span>}
                      {(project.actualHours ?? 0) > 0 && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {project.actualHours}h logged
                        </span>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" asChild className="h-8 w-8 p-0">
                    <Link href={`/projects/${project.id}`}>
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
