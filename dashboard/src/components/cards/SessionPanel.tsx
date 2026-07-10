import {
  Activity,
  AudioLines,
  Fingerprint,
  Globe,
  Laptop,
  Monitor,
  type LucideIcon,
} from 'lucide-react';

import type { SessionStatus } from '../../apiClient.js';
import type { StreamDecision } from '../../lib/decisionData.js';
import {
  formatLifecycleState,
  lifecycleBadgeClass,
  riskLevelForState,
} from '../../lib/lifecycleStyles.js';
import { formatPercent, formatTimestamp } from '../../lib/utils.js';
import { LiveBadge } from '../../LiveBadge.js';
import { Badge } from '../ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card.js';
import { Skeleton } from '../ui/skeleton.js';

function riskBadgeVariant(
  risk: ReturnType<typeof riskLevelForState>,
): 'success' | 'warning' | 'danger' | 'critical' | 'muted' {
  switch (risk) {
    case 'low':
      return 'success';
    case 'medium':
      return 'warning';
    case 'high':
      return 'danger';
    case 'critical':
      return 'critical';
    default:
      return 'muted';
  }
}

export function SessionPanel({
  sessionId,
  status,
  decision,
  loading,
}: {
  readonly sessionId: string;
  readonly status: SessionStatus | null;
  readonly decision: StreamDecision | null;
  readonly loading: boolean;
}): React.JSX.Element {
  const lifecycleState = status?.lifecycleState ?? decision?.lifecycleState;
  const probability = decision?.evidenceRef.posterior.probability;
  const lastUpdated = decision?.decidedAt ?? status?.sessionId;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Candidate Session</CardTitle>
        <CardDescription>Live session overview for the selected interview</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Session ID" loading={loading}>
          <p className="break-all font-mono text-sm text-zinc-900">{sessionId}</p>
        </Metric>
        <Metric label="Lifecycle State" loading={loading}>
          {lifecycleState !== undefined ? (
            <Badge className={lifecycleBadgeClass(lifecycleState)}>
              {formatLifecycleState(lifecycleState)}
            </Badge>
          ) : (
            <span className="text-sm text-zinc-500">—</span>
          )}
        </Metric>
        <Metric label="Confidence Score" loading={loading}>
          {probability !== undefined ? (
            <p className="text-lg font-semibold text-zinc-900">{formatPercent(probability)}</p>
          ) : (
            <p className="text-sm text-zinc-500">Awaiting live decision stream</p>
          )}
        </Metric>
        <Metric label="Risk Badge" loading={loading}>
          {lifecycleState !== undefined ? (
            <Badge variant={riskBadgeVariant(riskLevelForState(lifecycleState))}>
              {riskLevelForState(lifecycleState).toUpperCase()}
            </Badge>
          ) : (
            <span className="text-sm text-zinc-500">—</span>
          )}
        </Metric>
        <Metric label="Live Badge" loading={loading}>
          {lifecycleState !== undefined ? (
            <LiveBadge lifecycleState={lifecycleState} />
          ) : (
            <span className="text-sm text-zinc-500">—</span>
          )}
        </Metric>
        <Metric label="Last Updated" loading={loading}>
          <p className="text-sm text-zinc-700">{formatTimestamp(lastUpdated)}</p>
        </Metric>
        <Metric label="Accommodation Disclosure" loading={loading}>
          <Badge variant={status?.hasAccommodationDisclosure ? 'warning' : 'muted'}>
            {status?.hasAccommodationDisclosure ? 'On file' : 'None'}
          </Badge>
        </Metric>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  loading,
  children,
}: {
  readonly label: string;
  readonly loading: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-50/60 p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      {loading ? <Skeleton className="h-6 w-28" /> : children}
    </div>
  );
}

const ICON_BY_KEY: Record<string, LucideIcon> = {
  identity: Fingerprint,
  audio: AudioLines,
  video: Monitor,
  metadata: Globe,
  device: Laptop,
  language: Activity,
};

function healthVariant(
  health: string,
): 'success' | 'warning' | 'danger' | 'muted' {
  switch (health) {
    case 'OK':
      return 'success';
    case 'NO_SIGNAL_DETECTED':
      return 'warning';
    case 'SERVICE_UNAVAILABLE':
      return 'danger';
    default:
      return 'muted';
  }
}

export function EvidenceSummary({
  summaries,
  loading,
}: {
  readonly summaries: readonly {
    readonly key: string;
    readonly label: string;
    readonly healthStatus: string;
    readonly confidence: number | null;
    readonly lastUpdate: string | null;
    readonly eventCount: number;
  }[];
  readonly loading: boolean;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence Summary</CardTitle>
        <CardDescription>Signal health and contribution by evidence family</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {summaries.map((summary) => {
          const Icon = ICON_BY_KEY[summary.key] ?? Activity;
          return (
            <div
              key={summary.key}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2">
                    <Icon className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                  </div>
                  <p className="font-medium text-zinc-900">{summary.label}</p>
                </div>
                <Badge variant={healthVariant(summary.healthStatus)}>
                  {summary.healthStatus === 'unavailable'
                    ? 'No data'
                    : summary.healthStatus.replaceAll('_', ' ').toLowerCase()}
                </Badge>
              </div>
              {loading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <div className="space-y-2 text-sm text-zinc-600">
                  <p>
                    Confidence:{' '}
                    <span className="font-medium text-zinc-900">
                      {summary.confidence === null
                        ? '—'
                        : formatPercent(summary.confidence)}
                    </span>
                  </p>
                  <p>
                    Events:{' '}
                    <span className="font-medium text-zinc-900">{summary.eventCount}</span>
                  </p>
                  <p>
                    Last update:{' '}
                    <span className="font-medium text-zinc-900">
                      {formatTimestamp(summary.lastUpdate ?? undefined)}
                    </span>
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
