'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Users, FolderOpen, Settings, ArrowRight, Building2, Trash2 } from 'lucide-react';
import { Department } from '@/lib/supabase';
import { UserWithRoles } from '@/lib/rbac';
// Permission check is handled server-side via canManageDepartments prop
import DepartmentCreateDialog from './department-create-dialog';
import DepartmentDeleteDialog from './department-delete-dialog';

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

interface DepartmentListProps {
  departments: Department[];
  canCreateDepartments: boolean;
  canManageDepartments: boolean;
  userProfile: UserWithRoles | null;
  initialDepartmentMetrics?: Record<string, DepartmentMetrics>;
}

export function DepartmentList({
  departments,
  canCreateDepartments,
  canManageDepartments,
  userProfile: _userProfile,
  initialDepartmentMetrics,
}: DepartmentListProps) {
  // Departments are already filtered server-side based on permissions
  // No need to re-filter client-side - the server already determined
  // which departments this user can see via canViewDepartment checks
  const visibleDepartments = departments;

  // Note: Capacity and project metrics are now provided by server-side rendering
  // via initialDepartmentMetrics prop, so we don't need to fetch them client-side

  // Use server-side metrics - all departments should have metrics from server
  const getMetrics = (departmentId: string): DepartmentMetrics => {
    // Always prefer server-side metrics
    if (initialDepartmentMetrics?.[departmentId]) {
      return initialDepartmentMetrics[departmentId];
    }

    // Fallback for departments without metrics (shouldn't happen in normal operation)
    return {
      id: departmentId,
      name: departments.find((d: any) => d.id === departmentId)?.name || 'Unknown',
      description: departments.find((d: any) => d.id === departmentId)?.description || null,
      activeProjects: 0,
      teamSize: 0,
      capacityUtilization: 0,
      projectHealth: {
        healthy: 0,
        atRisk: 0,
        critical: 0,
      },
      workloadDistribution: [],
      recentProjects: [],
    };
  };

  const getHealthScore = (metrics: DepartmentMetrics): number => {
    const total =
      metrics.projectHealth.healthy + metrics.projectHealth.atRisk + metrics.projectHealth.critical;
    if (total === 0) return 100;
    return Math.round((metrics.projectHealth.healthy / total) * 100);
  };

  const getHealthColor = (score: number): string => {
    if (score >= 80) return 'text-green-600 bg-green-100 hover:!bg-green-200 hover:!text-green-700';
    if (score >= 60)
      return 'text-yellow-600 bg-yellow-100 hover:!bg-yellow-200 hover:!text-yellow-700';
    return 'text-red-600 bg-red-100 hover:!bg-red-200 hover:!text-red-700';
  };

  const getHealthLabel = (score: number): string => {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Needs Attention';
    return 'Critical';
  };

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      {canCreateDepartments && (
        <div className="flex justify-end">
          <DepartmentCreateDialog
            onDepartmentCreated={() => {
              // Refresh the page to show the new department
              window.location.reload();
            }}
          >
            <Button
              data-tutorial="create-department"
              className="inline-flex items-center space-x-2"
            >
              <Plus className="h-4 w-4" />
              <span>Create Department</span>
            </Button>
          </DepartmentCreateDialog>
        </div>
      )}

      {/* Departments Grid */}
      {visibleDepartments.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Building2 className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
            <h3 className="text-foreground mb-2 text-lg font-medium">No Departments Found</h3>
            <p className="text-muted-foreground mb-6">
              {canCreateDepartments
                ? 'Get started by creating your first department.'
                : 'No departments have been created yet.'}
            </p>
            {canCreateDepartments && (
              <DepartmentCreateDialog
                onDepartmentCreated={() => {
                  // Refresh the page to show the new department
                  window.location.reload();
                }}
              >
                <Button data-tutorial="create-department">
                  <Plus className="mr-2 h-4 w-4" />
                  Create First Department
                </Button>
              </DepartmentCreateDialog>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {visibleDepartments.map((department: any) => {
            const metrics = getMetrics(department.id);
            const healthScore = getHealthScore(metrics);

            return (
              <Card key={department.id} className="transition-shadow hover:shadow-lg">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{department.name}</CardTitle>
                      {department.description && (
                        <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                          {department.description}
                        </p>
                      )}
                    </div>
                    {canManageDepartments && (
                      <div className="flex items-center space-x-1">
                        <Link href={`/departments/${department.id}/admin`}>
                          <button
                            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors focus:ring-2 focus:ring-gray-300 focus:outline-none"
                            title="Manage Department"
                          >
                            <Settings className="h-4 w-4" />
                          </button>
                        </Link>
                        <DepartmentDeleteDialog
                          departmentId={department.id}
                          departmentName={department.name}
                          onDepartmentDeleted={() => {
                            // Refresh the page to show updated department list
                            window.location.reload();
                          }}
                        >
                          <button
                            className="hover:bg-destructive/10 inline-flex h-8 w-8 items-center justify-center rounded-md text-red-600 transition-colors hover:text-red-700 focus:ring-2 focus:ring-red-300 focus:outline-none"
                            title="Delete Department"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </DepartmentDeleteDialog>
                      </div>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Health Score */}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-sm font-medium">Health Score</span>
                    <Badge className={getHealthColor(healthScore)}>
                      {getHealthLabel(healthScore)} ({healthScore}%)
                    </Badge>
                  </div>

                  {/* Key Metrics */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center space-x-2">
                      <FolderOpen className="h-4 w-4 text-blue-600" />
                      <div>
                        <p className="text-foreground text-sm font-medium">
                          {metrics.activeProjects}
                        </p>
                        <p className="text-muted-foreground text-xs">Projects</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Users className="h-4 w-4 text-green-600" />
                      <div>
                        <p className="text-foreground text-sm font-medium">{metrics.teamSize}</p>
                        <p className="text-muted-foreground text-xs">Team Size</p>
                      </div>
                    </div>
                  </div>

                  {/* Capacity Utilization */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-sm font-medium">Capacity</span>
                      <span className="text-foreground text-sm font-medium">
                        {metrics.capacityUtilization}%
                      </span>
                    </div>
                    <div className="bg-muted h-2 w-full rounded-full">
                      <div
                        className={`h-2 rounded-full ${
                          metrics.capacityUtilization >= 90
                            ? 'bg-red-500'
                            : metrics.capacityUtilization >= 75
                              ? 'bg-yellow-500'
                              : 'bg-green-500'
                        }`}
                        style={{ width: `${metrics.capacityUtilization}%` }}
                      />
                    </div>
                  </div>

                  {/* Project Health Breakdown */}
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-sm font-medium">Project Status</p>
                    <div className="flex space-x-2">
                      <Badge className="border-green-200 bg-green-100 text-emerald-400 hover:!bg-green-200 hover:!text-emerald-400">
                        {metrics.projectHealth.healthy} Healthy
                      </Badge>
                      {metrics.projectHealth.atRisk > 0 && (
                        <Badge className="border-yellow-200 bg-yellow-100 text-amber-400 hover:!bg-yellow-200 hover:!text-amber-400">
                          {metrics.projectHealth.atRisk} At Risk
                        </Badge>
                      )}
                      {metrics.projectHealth.critical > 0 && (
                        <Badge className="text-destructive hover:!text-destructive border-red-200 bg-red-100 hover:!bg-red-200">
                          {metrics.projectHealth.critical} Critical
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="pt-2">
                    <Link href={`/departments/${department.id}`}>
                      <Button variant="outline" className="w-full">
                        View Details
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
