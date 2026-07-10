import { ArrowUpRight, CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import { useState } from 'react';

import type { StreamDecision } from '../../lib/decisionData.js';
import { formatLifecycleState } from '../../lib/lifecycleStyles.js';
import { formatPercent } from '../../lib/utils.js';
import type { LifecycleState } from '../../liveBadgeLogic.js';
import { EmptyState } from '../EmptyState.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card.js';
import { Input } from '../ui/input.js';
import { Skeleton } from '../ui/skeleton.js';

const ALL_LIFECYCLE_STATES: readonly LifecycleState[] = [
  'UNKNOWN',
  'POSSIBLE_CANDIDATE',
  'LIKELY_CANDIDATE',
  'HIGHLY_CONFIDENT',
  'CONFIRMED',
  'RECOVERED',
  'LOST_CONFIDENCE',
  'DISQUALIFIED',
];

export function DecisionPanel({
  decision,
  loading,
  overrideReason,
  onOverrideReasonChange,
  onApprove,
  onEscalate,
  onReject,
  onOverrideState,
  submitting,
}: {
  readonly decision: StreamDecision | null;
  readonly loading: boolean;
  readonly overrideReason: string;
  readonly onOverrideReasonChange: (value: string) => void;
  readonly onApprove: () => void;
  readonly onEscalate: () => void;
  readonly onReject: () => void;
  readonly onOverrideState: (state: LifecycleState) => void;
  readonly submitting: boolean;
}): React.JSX.Element {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Decision</CardTitle>
        <CardDescription>Latest structured decision and reviewer actions</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : decision === null ? (
          <EmptyState variant="waiting-activity" className="border-none shadow-none" />
        ) : (
          <div className="grid gap-4 rounded-xl border border-border bg-muted/50 p-5 lg:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Decision</p>
              <p className="mt-1 text-lg font-semibold text-zinc-900">
                {formatLifecycleState(decision.lifecycleState)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Confidence
              </p>
              <p className="mt-1 text-lg font-semibold text-zinc-900">
                {formatPercent(decision.evidenceRef.posterior.probability)}
              </p>
            </div>
            <div className="lg:col-span-2">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Reason</p>
              <p className="mt-1 text-sm text-zinc-700">
                {decision.alert?.reason ??
                  (decision.abstained
                    ? 'Abstained — insufficient evidence for a definitive assessment'
                    : decision.ambiguous
                      ? 'Ambiguous posterior — reviewer judgment recommended'
                      : 'No alert raised on the latest evaluation tick')}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Top evidence
              </p>
              <p className="mt-1 text-sm text-zinc-700">
                {decision.evidenceRef.posterior.eligibleEventCount} eligible events across{' '}
                {decision.evidenceRef.posterior.bundleContributions.length} bundles
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Recommended action
              </p>
              <Badge variant="outline" className="mt-1">
                {decision.reviewerRecommendation.replaceAll('_', ' ').toLowerCase()}
              </Badge>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <label htmlFor="override-reason" className="text-sm font-medium text-zinc-700">
            Override reason (optional)
          </label>
          <Input
            id="override-reason"
            placeholder="Document reviewer rationale..."
            value={overrideReason}
            onChange={(event) => onOverrideReasonChange(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={onApprove} disabled={submitting} className="min-w-[120px]">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Approve
          </Button>
          <Button
            variant="secondary"
            onClick={() => setShowAdvanced((value) => !value)}
            disabled={submitting}
          >
            Override
          </Button>
          <Button variant="outline" onClick={onEscalate} disabled={submitting}>
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            Escalate
          </Button>
          <Button variant="destructive" onClick={onReject} disabled={submitting}>
            <XCircle className="h-4 w-4" aria-hidden="true" />
            Reject
          </Button>
        </div>

        {showAdvanced && (
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-700">
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              Advanced lifecycle override
            </div>
            <div className="flex flex-wrap gap-2">
              {ALL_LIFECYCLE_STATES.map((state) => (
                <Button
                  key={state}
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  onClick={() => onOverrideState(state)}
                >
                  {formatLifecycleState(state)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
