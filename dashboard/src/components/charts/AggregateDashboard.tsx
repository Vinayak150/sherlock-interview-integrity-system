import {
  AlertTriangle,
  BarChart3,
  ClipboardList,
  Gauge,
  PieChart as PieChartIcon,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { AggregateStatus } from '../../apiClient.js';
import { formatPercent } from '../../lib/utils.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card.js';
import { Progress } from '../ui/progress.js';
import { Skeleton } from '../ui/skeleton.js';

const STATE_COLORS = [
  '#71717a',
  '#a1a1aa',
  '#3b82f6',
  '#6366f1',
  '#16a34a',
  '#22c55e',
  '#f97316',
  '#dc2626',
];

const REVIEW_STATES = new Set([
  'UNKNOWN',
  'LOST_CONFIDENCE',
  'DISQUALIFIED',
  'POSSIBLE_CANDIDATE',
  'LIKELY_CANDIDATE',
]);

export function AggregateDashboard({
  aggregate,
  loading,
}: {
  readonly aggregate: AggregateStatus | null;
  readonly loading: boolean;
}): React.JSX.Element {
  if (loading && aggregate === null) {
    return (
      <section aria-label="Aggregate dashboard" className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </section>
    );
  }

  if (aggregate === null) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-zinc-500">
          Aggregate metrics are unavailable right now.
        </CardContent>
      </Card>
    );
  }

  const lifecycleData = Object.entries(aggregate.countsByState).map(([state, count]) => ({
    state: state.replaceAll('_', ' '),
    count,
  }));

  const underReview = Object.entries(aggregate.countsByState).reduce(
    (sum, [state, count]) => (REVIEW_STATES.has(state) ? sum + count : sum),
    0,
  );
  const criticalAlerts =
    (aggregate.countsByState.DISQUALIFIED ?? 0) + (aggregate.countsByState.LOST_CONFIDENCE ?? 0);

  const reviewQueue = Object.entries(aggregate.countsByState)
    .filter(([state]) => REVIEW_STATES.has(state))
    .map(([state, count]) => ({ state: state.replaceAll('_', ' '), count }))
    .sort((a, b) => b.count - a.count);

  const recentAlerts = [
    {
      label: 'Disqualified sessions',
      count: aggregate.countsByState.DISQUALIFIED ?? 0,
    },
    {
      label: 'Lost confidence sessions',
      count: aggregate.countsByState.LOST_CONFIDENCE ?? 0,
    },
  ];

  return (
    <section aria-label="Aggregate dashboard" className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric
          icon={BarChart3}
          title="Replica Sessions"
          value={String(aggregate.totalSessions)}
          subtitle="Sessions tracked on this replica"
        />
        <SummaryMetric
          icon={Gauge}
          title="Unknown Rate"
          value={formatPercent(aggregate.unknownRate)}
          subtitle="Share of sessions in UNKNOWN"
        />
        <SummaryMetric
          icon={ClipboardList}
          title="Under Review"
          value={String(underReview)}
          subtitle="Sessions needing reviewer attention"
        />
        <SummaryMetric
          icon={AlertTriangle}
          title="Critical Alerts"
          value={String(criticalAlerts)}
          subtitle="Disqualified or lost confidence"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-4 w-4" aria-hidden="true" />
              Unknown Rate Gauge
            </CardTitle>
            <CardDescription>Current UNKNOWN share across active sessions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end justify-between">
              <p className="text-4xl font-semibold text-zinc-900">
                {formatPercent(aggregate.unknownRate)}
              </p>
              <p className="text-sm text-zinc-500">Target: minimize abstention</p>
            </div>
            <Progress value={aggregate.unknownRate * 100} aria-label="Unknown rate progress" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-4 w-4" aria-hidden="true" />
              Lifecycle Distribution
            </CardTitle>
            <CardDescription>Session counts by lifecycle state</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={lifecycleData}
                  dataKey="count"
                  nameKey="state"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {lifecycleData.map((entry, index) => (
                    <Cell key={entry.state} fill={STATE_COLORS[index % STATE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lifecycle Counts</CardTitle>
            <CardDescription>Bar chart of state distribution</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lifecycleData}>
                <XAxis dataKey="state" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={70} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#18181b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Review Queue</CardTitle>
            <CardDescription>Sessions most likely to need reviewer action</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {reviewQueue.length === 0 ? (
              <p className="text-sm text-zinc-500">No sessions in the review queue.</p>
            ) : (
              reviewQueue.map((item) => (
                <div key={item.state} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-zinc-800">{item.state}</span>
                    <span className="text-zinc-500">{item.count}</span>
                  </div>
                  <Progress
                    value={
                      aggregate.totalSessions === 0
                        ? 0
                        : (item.count / aggregate.totalSessions) * 100
                    }
                    aria-label={`${item.state} queue share`}
                  />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Alerts</CardTitle>
          <CardDescription>High-attention lifecycle states on this replica</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {recentAlerts.map((alert) => (
            <div
              key={alert.label}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3"
            >
              <span className="text-sm font-medium text-zinc-800">{alert.label}</span>
              <span className="text-lg font-semibold text-zinc-900">{alert.count}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function SummaryMetric({
  icon: Icon,
  title,
  value,
  subtitle,
}: {
  readonly icon: typeof Gauge;
  readonly title: string;
  readonly value: string;
  readonly subtitle: string;
}): React.JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <p className="text-sm text-zinc-500">{title}</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-900">{value}</p>
          <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2.5">
          <Icon className="h-5 w-5 text-zinc-600" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}
