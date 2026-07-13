'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarClock, AlertTriangle, Clock, CalendarDays, ArrowRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import useSWR from 'swr';
import Link from 'next/link';
import { SimpleCounter } from '@/components/ui/animated-counter';
import { fadeInUp, staggerContainer, listItemFadeUp } from '@/lib/animation-variants';

interface DeadlineItem {
  id: string;
  name: string;
  dueDate: string;
  dueDateLabel: string;
  projectName: string;
  projectId: string;
  status: string;
  priority: string;
  isOverdue: boolean;
  isDueToday: boolean;
  daysUntilDue: number;
}

interface DeadlinesResponse {
  success: boolean;
  data: {
    deadlines: DeadlineItem[];
    overdueCount: number;
    dueTodayCount: number;
    thisWeekCount: number;
    totalCount: number;
  };
}

const fetcher = (url: string) =>
  apiFetch(url).then((res) => {
    if (!res.ok) throw new Error('Failed to fetch');
    return res.json();
  });

function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'urgent':
      return 'bg-[#3D464D]/10 text-[#3D464D] dark:bg-[#3D464D]/20 dark:text-[#7B8994]';
    case 'high':
      return 'bg-[#475250]/10 text-[#475250] dark:bg-[#475250]/20 dark:text-[#787878]';
    case 'medium':
      return 'bg-[#647878]/10 text-[#647878] dark:bg-[#647878]/20 dark:text-[#647878]';
    default:
      return 'bg-muted text-foreground dark:bg-gray-800 dark:text-muted-foreground';
  }
}

// Summary pill component
function SummaryPill({
  icon: Icon,
  count,
  label,
  bgColor,
  textColor,
  iconColor,
  isUrgent = false,
  delay = 0,
}: {
  icon: React.ElementType;
  count: number;
  label: string;
  bgColor: string;
  textColor: string;
  iconColor: string;
  isUrgent?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 5 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className={cn(
        'relative flex items-center gap-1.5 overflow-hidden rounded-full px-2.5 py-1.5 text-xs font-medium',
        bgColor,
        textColor,
      )}
    >
      <Icon className={cn('h-3 w-3', iconColor)} />
      <span className="tabular-nums">
        <SimpleCounter value={count} duration={0.8} />
      </span>
      <span>{label}</span>
      {/* Pulse effect for urgent items */}
      {isUrgent && count > 0 && (
        <motion.div
          className="absolute inset-0 rounded-full bg-red-500/10"
          animate={{
            opacity: [0, 0.5, 0],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}
    </motion.div>
  );
}

// Deadline item component
function DeadlineItem({
  deadline,
  index,
  isLast,
}: {
  deadline: DeadlineItem;
  index: number;
  isLast: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.08 }}
    >
      <Link href={`/projects/${deadline.projectId}?task=${deadline.id}`} className="block">
        <div
          className={cn(
            'group hover:bg-muted/30 flex items-start gap-3 rounded-lg p-2.5 transition-all duration-200',
            deadline.isOverdue && 'bg-[#3D464D]/5 dark:bg-[#3D464D]/10',
            deadline.isDueToday && !deadline.isOverdue && 'bg-[#007EE5]/5 dark:bg-[#007EE5]/10',
          )}
        >
          {/* Timeline dot and line */}
          <div className="flex flex-col items-center pt-1.5">
            <motion.div
              className={cn(
                'h-2.5 w-2.5 shrink-0 rounded-full',
                deadline.isOverdue
                  ? 'bg-[#475250]'
                  : deadline.isDueToday
                    ? 'bg-[#007EE5]'
                    : 'bg-[#647878]',
              )}
              animate={
                deadline.isOverdue || deadline.isDueToday
                  ? {
                      scale: [1, 1.2, 1],
                      opacity: [1, 0.7, 1],
                    }
                  : {}
              }
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
            {!isLast && (
              <motion.div
                className="bg-muted mt-1 w-0.5 flex-1"
                initial={{ height: 0 }}
                animate={{ height: '100%' }}
                transition={{ delay: 0.2 + index * 0.05, duration: 0.3 }}
              />
            )}
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <p className="group-hover:text-primary truncate text-sm font-medium transition-colors">
              {deadline.name}
            </p>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-muted-foreground truncate text-xs">{deadline.projectName}</span>
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.1 + index * 0.05 }}
              >
                <Badge
                  variant="secondary"
                  className={cn('px-1.5 py-0 text-[10px]', getPriorityColor(deadline.priority))}
                >
                  {deadline.priority}
                </Badge>
              </motion.div>
            </div>
          </div>

          {/* Due date label */}
          <div className="flex shrink-0 items-center gap-1.5 text-right">
            <span
              className={cn(
                'text-xs font-medium',
                deadline.isOverdue
                  ? 'text-[#3D464D] dark:text-[#7B8994]'
                  : deadline.isDueToday
                    ? 'text-[#007EE5]'
                    : 'text-muted-foreground',
              )}
            >
              {deadline.dueDateLabel}
            </span>
            <ArrowRight className="text-muted-foreground h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export function UpcomingDeadlinesWidget() {
  const { data, error, isLoading } = useSWR<DeadlinesResponse>(
    '/api/dashboard/upcoming-deadlines',
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    },
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-44" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-20 rounded-full" />
          </div>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <motion.div variants={fadeInUp} initial="hidden" animate="visible">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <CalendarClock className="text-muted-foreground h-4 w-4" />
              Upcoming Deadlines
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Failed to load data</p>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  const deadlines = data?.data?.deadlines || [];
  const { overdueCount = 0, dueTodayCount = 0, thisWeekCount = 0 } = data?.data || {};

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeInUp} className="h-full">
      <Card className="flex h-full flex-col">
        <CardHeader className="flex-shrink-0 pb-2">
          <CardTitle className="flex items-center justify-between text-sm font-medium">
            <div className="flex items-center gap-2">
              <CalendarClock className="text-muted-foreground h-4 w-4" />
              Upcoming Deadlines
            </div>
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-muted-foreground text-xs font-normal"
            >
              Next 14 Days
            </motion.span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col">
          {deadlines.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-muted-foreground py-8 text-center text-sm"
            >
              <CalendarClock className="mx-auto mb-2 h-8 w-8 text-[#647878]/50" />
              No upcoming deadlines
            </motion.div>
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="space-y-4"
            >
              {/* Summary Pills */}
              <div className="flex flex-wrap gap-2">
                {overdueCount > 0 && (
                  <SummaryPill
                    icon={AlertTriangle}
                    count={overdueCount}
                    label="overdue"
                    bgColor="bg-[#3D464D]/10 dark:bg-[#3D464D]/20"
                    textColor="text-[#3D464D] dark:text-[#7B8994]"
                    iconColor="text-[#475250]"
                    isUrgent={true}
                    delay={0}
                  />
                )}
                {dueTodayCount > 0 && (
                  <SummaryPill
                    icon={Clock}
                    count={dueTodayCount}
                    label="today"
                    bgColor="bg-[#007EE5]/10 dark:bg-[#007EE5]/20"
                    textColor="text-[#007EE5] dark:text-[#007EE5]"
                    iconColor="text-[#007EE5]"
                    delay={0.1}
                  />
                )}
                {thisWeekCount > 0 && (
                  <SummaryPill
                    icon={CalendarDays}
                    count={thisWeekCount}
                    label="this week"
                    bgColor="bg-[#647878]/10 dark:bg-[#647878]/20"
                    textColor="text-[#647878] dark:text-[#787878]"
                    iconColor="text-[#647878]"
                    delay={0.2}
                  />
                )}
              </div>

              {/* Timeline */}
              <motion.div variants={listItemFadeUp} className="space-y-1">
                <AnimatePresence mode="popLayout">
                  {deadlines.slice(0, 5).map((deadline, index) => (
                    <DeadlineItem
                      key={deadline.id}
                      deadline={deadline}
                      index={index}
                      isLast={index === Math.min(deadlines.length, 5) - 1}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>

              {deadlines.length > 5 && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="text-muted-foreground text-center text-xs"
                >
                  +{deadlines.length - 5} more deadlines
                </motion.p>
              )}
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default UpcomingDeadlinesWidget;
