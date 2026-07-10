import { Activity, AlertTriangle, HelpCircle, Users } from 'lucide-react';

import type { AggregateStatus } from '../apiClient.js';
import { formatPercent } from '../lib/utils.js';
import { StatCard } from './cards/StatCard.js';

export function StatisticsRow({
  aggregate,
  loading,
}: {
  readonly aggregate: AggregateStatus | null;
  readonly loading: boolean;
}): React.JSX.Element {
  const underReview =
    aggregate === null
      ? 0
      : Object.entries(aggregate.countsByState).reduce(
          (sum, [state, count]) =>
            state === 'UNKNOWN' ||
            state === 'LOST_CONFIDENCE' ||
            state === 'DISQUALIFIED' ||
            state === 'POSSIBLE_CANDIDATE' ||
            state === 'LIKELY_CANDIDATE'
              ? sum + count
              : sum,
          0,
        );

  const criticalAlerts =
    aggregate === null
      ? 0
      : (aggregate.countsByState.DISQUALIFIED ?? 0) +
        (aggregate.countsByState.LOST_CONFIDENCE ?? 0);

  return (
    <section aria-label="Statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        title="Total Sessions"
        value={aggregate === null ? '—' : String(aggregate.totalSessions)}
        subtitle="Active sessions on this replica"
        icon={Users}
        loading={loading}
      />
      <StatCard
        title="Unknown Rate"
        value={aggregate === null ? '—' : formatPercent(aggregate.unknownRate)}
        subtitle="Share currently abstaining"
        icon={HelpCircle}
        loading={loading}
      />
      <StatCard
        title="Sessions Under Review"
        value={String(underReview)}
        subtitle="Sessions needing attention"
        icon={Activity}
        loading={loading}
      />
      <StatCard
        title="Critical Alerts"
        value={String(criticalAlerts)}
        subtitle="Disqualified or lost confidence"
        icon={AlertTriangle}
        loading={loading}
      />
    </section>
  );
}
