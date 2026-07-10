import type { StreamDecision } from '../../lib/decisionData.js';
import { formatPercent, formatTimestamp } from '../../lib/utils.js';
import { EmptyState } from '../EmptyState.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card.js';
import { Input } from '../ui/input.js';
import { Skeleton } from '../ui/skeleton.js';

export function ExplanationPanel({
  decision,
  loading,
}: {
  readonly decision: StreamDecision | null;
  readonly loading: boolean;
}): React.JSX.Element {
  const topSignals = decision?.evidenceRef.events.slice(0, 5) ?? [];
  const contradictions =
    decision?.evidenceRef.events.filter((event) => event.healthStatus === 'SERVICE_UNAVAILABLE') ??
    [];

  return (
    <Card className="flex max-h-[32rem] flex-col">
      <CardHeader>
        <CardTitle>Explanation</CardTitle>
        <CardDescription>
          Structured report details available from the live decision stream
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-5 overflow-y-auto pr-2">
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : decision === null ? (
          <EmptyState variant="waiting-activity" className="border-none shadow-none" />
        ) : (
          <>
            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">Evidence ranking</h3>
              {topSignals.length === 0 ? (
                <p className="text-sm text-zinc-500">No ranked signals available yet.</p>
              ) : (
                <ul className="space-y-2">
                  {topSignals.map((signal) => (
                    <li
                      key={signal.id}
                      className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-zinc-900">{signal.signalName}</span>
                      <span className="text-zinc-500"> · {signal.bundle}</span>
                      <span className="block text-xs text-zinc-500">
                        {formatTimestamp(signal.occurredAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">Narrative</h3>
              <p className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3 text-sm text-zinc-600">
                The full Evidence Report narrative is generated server-side but is not exposed via
                the dashboard API. Use the structured fields below from the live decision stream.
              </p>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">Supporting observations</h3>
              <div className="grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
                <p>
                  Probability:{' '}
                  <span className="font-medium">
                    {formatPercent(decision.evidenceRef.posterior.probability)}
                  </span>
                </p>
                <p>
                  Credible interval:{' '}
                  <span className="font-medium">
                    {formatPercent(decision.evidenceRef.posterior.credibleInterval.lower)} –{' '}
                    {formatPercent(decision.evidenceRef.posterior.credibleInterval.upper)}
                  </span>
                </p>
                <p>
                  Abstained: <span className="font-medium">{decision.abstained ? 'Yes' : 'No'}</span>
                </p>
                <p>
                  Ambiguous: <span className="font-medium">{decision.ambiguous ? 'Yes' : 'No'}</span>
                </p>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">Contradictions</h3>
              {contradictions.length === 0 ? (
                <p className="text-sm text-zinc-500">No unavailable-service contradictions listed.</p>
              ) : (
                <ul className="space-y-2">
                  {contradictions.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-sm text-orange-800"
                    >
                      {item.bundle}/{item.signalName} — service unavailable
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">Recommendations</h3>
              <p className="text-sm text-zinc-700">
                {decision.reviewerRecommendation.replaceAll('_', ' ').toLowerCase()}
                {decision.elicitationTrigger !== null
                  ? ` · Elicitation: ${decision.elicitationTrigger.challengeType.replaceAll('_', ' ').toLowerCase()}`
                  : ''}
              </p>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function AccommodationForm({
  reason,
  onReasonChange,
  onSubmit,
  disabled,
}: {
  readonly reason: string;
  readonly onReasonChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly disabled: boolean;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Accommodation Disclosure</CardTitle>
        <CardDescription>Record accommodation context for this session (RFC §11)</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row">
        <Input
          aria-label="Accommodation disclosure reason"
          placeholder="Reason (e.g. interpreter present)"
          value={reason}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => onReasonChange(event.target.value)}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || reason.trim() === ''}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          Record disclosure
        </button>
      </CardContent>
    </Card>
  );
}
