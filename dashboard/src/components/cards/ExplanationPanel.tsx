import type { StreamDecision } from '../../lib/decisionData.js';
import { buildExplanationView } from '../../lib/reasoningPresentation.js';
import { formatTimestamp } from '../../lib/utils.js';
import { EmptyState } from '../EmptyState.js';
import { Badge } from '../ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card.js';
import { Input } from '../ui/input.js';
import { Skeleton } from '../ui/skeleton.js';

function classificationVariant(
  outcome: string,
): 'success' | 'danger' | 'warning' | 'muted' {
  switch (outcome) {
    case 'SUPPORTS':
      return 'success';
    case 'CONTRADICTS':
      return 'danger';
    case 'MISSING':
      return 'warning';
    default:
      return 'muted';
  }
}

function EvidenceList({
  title,
  events,
  emptyLabel,
  outcomeLabel,
}: {
  readonly title: string;
  readonly events: readonly {
    readonly id: string;
    readonly bundle: string;
    readonly signalName: string;
    readonly occurredAt: string;
  }[];
  readonly emptyLabel: string;
  readonly outcomeLabel: 'SUPPORTS' | 'CONTRADICTS' | 'MISSING';
}): React.JSX.Element {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm dark:bg-muted/20"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{event.signalName}</span>
                <span className="text-muted-foreground">· {event.bundle}</span>
                <Badge variant={classificationVariant(outcomeLabel)} aria-label={outcomeLabel}>
                  {outcomeLabel.toLowerCase()}
                </Badge>
              </div>
              <span className="mt-1 block text-xs text-muted-foreground">
                {formatTimestamp(event.occurredAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ExplanationPanel({
  decision,
  loading,
}: {
  readonly decision: StreamDecision | null;
  readonly loading: boolean;
}): React.JSX.Element {
  const view = buildExplanationView(decision);

  return (
    <Card className="flex max-h-[40rem] flex-col">
      <CardHeader>
        <CardTitle>Explanation</CardTitle>
        <CardDescription>Structured fields derived from the live decision stream</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-5 overflow-y-auto pr-2">
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : view === null ? (
          <EmptyState variant="waiting-activity" className="border-none shadow-none" />
        ) : (
          <>
            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Executive Summary</h3>
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm text-foreground dark:bg-muted/20">
                {view.executiveSummary}
              </p>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Reasoning</h3>
              {view.reasoning.length === 0 ? (
                <p className="text-sm text-muted-foreground">No bundle contributions available.</p>
              ) : (
                <ul className="space-y-2">
                  {view.reasoning.map((line) => (
                    <li
                      key={line}
                      className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground dark:bg-muted/20"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Recommendation</h3>
              <p className="text-sm text-foreground">{view.recommendation}</p>
              {decision?.elicitationTrigger !== null && decision?.elicitationTrigger !== undefined && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Elicitation: {decision.elicitationTrigger.challengeType.replaceAll('_', ' ').toLowerCase()}
                </p>
              )}
            </section>

            <EvidenceList
              title="Supporting Evidence"
              events={view.supportingEvidence}
              emptyLabel="No supporting evidence classified."
              outcomeLabel="SUPPORTS"
            />
            <EvidenceList
              title="Conflicting Evidence"
              events={view.conflictingEvidence}
              emptyLabel="No conflicting evidence classified."
              outcomeLabel="CONTRADICTS"
            />
            <EvidenceList
              title="Missing Evidence"
              events={view.missingEvidence}
              emptyLabel="No missing evidence signals."
              outcomeLabel="MISSING"
            />
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
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            onReasonChange(event.target.value)
          }
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || reason.trim() === ''}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
        >
          Record disclosure
        </button>
      </CardContent>
    </Card>
  );
}
