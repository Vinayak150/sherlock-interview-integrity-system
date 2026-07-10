import type { LucideIcon } from 'lucide-react';

import { Card, CardContent } from '../ui/card.js';
import { Skeleton } from '../ui/skeleton.js';

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  loading = false,
}: {
  readonly title: string;
  readonly value: string;
  readonly subtitle: string;
  readonly icon: LucideIcon;
  readonly loading?: boolean;
}): React.JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-5">
        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-500">{title}</p>
          {loading ? (
            <Skeleton className="h-8 w-20" />
          ) : (
            <p className="text-3xl font-semibold tracking-tight text-zinc-900">{value}</p>
          )}
          <p className="text-xs text-zinc-500">{subtitle}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2.5" aria-hidden="true">
          <Icon className="h-5 w-5 text-zinc-600" />
        </div>
      </CardContent>
    </Card>
  );
}
