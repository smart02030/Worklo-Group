'use client';

import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface AnimatedCounterProps {
  value: number;
  previousValue?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  showTrend?: boolean;
  trendClassName?: string;
}

export function AnimatedCounter({
  value,
  previousValue,
  prefix = '',
  suffix = '',
  className,
  showTrend = false,
  trendClassName,
}: AnimatedCounterProps) {
  const trend = previousValue !== undefined ? value - previousValue : 0;

  return (
    <span className={cn('tabular-nums', className)}>
      {prefix}
      {value}
      {suffix}
      {showTrend && previousValue !== undefined && (
        <span className={cn('ml-1 text-xs', trendClassName)}>
          {trend > 0 ? (
            <TrendingUp className="inline h-3 w-3 text-green-500" />
          ) : trend < 0 ? (
            <TrendingDown className="inline h-3 w-3 text-red-500" />
          ) : (
            <Minus className="text-muted-foreground inline h-3 w-3" />
          )}
        </span>
      )}
    </span>
  );
}

interface SimpleCounterProps {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export function SimpleCounter({ value, prefix = '', suffix = '', className }: SimpleCounterProps) {
  return (
    <span className={cn('tabular-nums', className)}>
      {prefix}
      {value}
      {suffix}
    </span>
  );
}

export default AnimatedCounter;
